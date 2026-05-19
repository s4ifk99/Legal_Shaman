import "server-only";

import { chat } from "@/lib/llm/client";
import { sanitizeAdviceText } from "@/lib/guardrails/validator";
import type { ExtractedFilters } from "@/lib/agent/types";
import type { ParsedQuery } from "@/lib/legal-search/types";
import { detectVagueLegalQuery, getTaxonomyMatch } from "@/lib/legal-search/vague-query-rescue";

const SYSTEM_PROMPT = `You write ONE short clarifying question for a UK legal-directory search.

Rules:
- Single sentence, max 120 characters, no quotes.
- Ask only about: legal topic (e.g. divorce, immigration, dismissal), UK location/city, or required language.
- Never give legal advice. Never address the user's specific situation. Never use "you should".
- Do NOT propose answers, lawyers, or strategies.
- Output ONLY the question text. No prefix, no preamble.`;

/**
 * Decide whether the extraction is grounded enough to search.
 * Returns true when we have at least one of: practice area, location, language.
 * Optional `parsed` tightens rules for legal-aid intent and superlative queries.
 */
export function isExtractionGrounded(
  extracted: ExtractedFilters,
  parsed?: ParsedQuery,
): boolean {
  const hasArea = Boolean(extracted.practiceArea);
  const hasLoc = Boolean(extracted.city || extracted.postcode);
  const hasLang = (extracted.languages?.length ?? 0) > 0;
  const confident = extracted.confidence >= 0.55;
  const base = confident && (hasArea || hasLoc || hasLang);

  if (parsed?.intent === "find_legal_aid" || parsed?.legalAidSignal) {
    const locOk = hasLoc || Boolean(parsed.location || parsed.postcode);
    const issueOk = hasArea || Boolean(parsed.legalIssue && parsed.legalIssue.length > 8);
    if (!locOk || !issueOk) return false;
  }

  if (parsed?.rawText && /\bbest\b/i.test(parsed.rawText) && !hasArea) return false;

  if (parsed?.intent === "emergency" && !hasLoc && !hasArea) return false;

  if (
    parsed?.queryConfidence === "medium" &&
    getTaxonomyMatch(parsed) &&
    detectVagueLegalQuery(parsed)
  ) {
    return true;
  }

  return base;
}

const FALLBACK_QUESTION =
  "Which legal topic are you looking for help with, and which UK city should the lawyer be near?";

export async function generateClarifyingQuestion(
  query: string,
  extracted: ExtractedFilters,
): Promise<string> {
  const missing: string[] = [];
  if (!extracted.practiceArea) missing.push("legal topic");
  if (!extracted.city && !extracted.postcode) missing.push("city or area");

  try {
    const content = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `User wrote: "${query.slice(0, 400)}"\nMissing fields: ${missing.join(", ") || "none"}.\nWrite the clarifying question.`,
        },
      ],
      { temperature: 0.2, maxTokens: 60 },
    );
    const cleaned = sanitizeAdviceText(content.trim().replace(/^["'\s]+|["'\s]+$/g, ""));
    if (cleaned && cleaned.length > 0 && cleaned.length <= 140) return cleaned;
  } catch (err) {
    console.warn("[agent.clarifier] LLM call failed, using fallback:", err);
  }

  return FALLBACK_QUESTION;
}
