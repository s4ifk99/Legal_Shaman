import "server-only";

import { chat } from "@/lib/llm/client";
import {
  validateExplanation,
  validateOrgExplanation,
} from "@/lib/guardrails/validator";
import type { LawyerWithRelations } from "@/lib/lawyers/db";
import type { SraOrgLite } from "@/lib/lawyers/search";
import type { ExtractedFilters } from "@/lib/agent/types";

const LAWYER_PROMPT = `You write 1-sentence neutral match explanations for a UK legal-directory.

Hard rules:
- ONE sentence, max 160 characters, no quotes.
- Use ONLY facts from the LAWYER_RECORD JSON I give you. Never invent qualifications, fees, success rates, or experience details.
- Never give legal advice, never predict outcomes, never use "you", "should", "will win/lose".
- Focus on overlaps between the user's query topic and the lawyer's stored fields (practice areas, city, languages, years of experience, verified credentials).
- Output ONLY the sentence. No prefix.`;

const ORG_PROMPT = `You write 1-sentence neutral match explanations for a UK legal-directory.

The candidate is an SRA-REGISTERED FIRM (organisation), not an individual lawyer.

Hard rules:
- ONE sentence, max 160 characters, no quotes.
- Use ONLY facts from the FIRM_RECORD JSON I give you. Never invent practice areas, fees, success rates, or qualifications.
- Never give legal advice, never predict outcomes, never use "you", "should", "will win/lose".
- It IS okay to mention "SRA-verified firm" since that is a fact about every SRA register entry.
- Focus on overlaps between the user's query topic and the firm's stored fields (firm name, city, region).
- Output ONLY the sentence. No prefix.`;

export type ExplainArg =
  | { kind: "lawyer"; lawyer: LawyerWithRelations; extracted: ExtractedFilters }
  | { kind: "org"; org: SraOrgLite; extracted: ExtractedFilters };

/**
 * Generate one neutral explanation per candidate. Each explanation passes
 * through the guardrail validator; on rejection we fall back to a
 * deterministic template built from structured fields only.
 *
 * Map key: lawyer.id  or  `sra-<sraId>` (i.e. SraOrgLite.id) — matches the
 * candidate id used elsewhere in the pipeline.
 */
export async function explainMatches(items: ExplainArg[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "lawyer") {
      out.set(item.lawyer.id, await explainLawyer(item.lawyer, item.extracted));
    } else {
      out.set(item.org.id, await explainOrg(item.org, item.extracted));
    }
  }
  return out;
}

// =============================================================================
// Lawyer explanation
// =============================================================================

async function explainLawyer(
  lawyer: LawyerWithRelations,
  extracted: ExtractedFilters,
): Promise<string> {
  const record = compactLawyerRecord(lawyer);
  const fallback = templateLawyerExplanation(lawyer, extracted);
  try {
    const content = await chat(
      [
        { role: "system", content: LAWYER_PROMPT },
        {
          role: "user",
          content: `USER_QUERY_TOPIC: ${extracted.semanticQuery}\nLAWYER_RECORD: ${JSON.stringify(record)}\nWrite the explanation.`,
        },
      ],
      { temperature: 0.2, maxTokens: 80 },
    );
    const candidate = content.trim().replace(/^["'\s]+|["'\s]+$/g, "");
    return validateExplanation(candidate, lawyer) ?? fallback;
  } catch (err) {
    console.warn("[agent.explainer] lawyer LLM call failed, using template:", err);
    return fallback;
  }
}

function compactLawyerRecord(lawyer: LawyerWithRelations) {
  return {
    name: lawyer.name,
    firm: lawyer.firm?.name ?? null,
    practiceAreas: lawyer.practiceAreas.map((p) => p.practiceArea.name),
    city: lawyer.locations[0]?.city ?? null,
    jurisdiction: lawyer.locations[0]?.jurisdiction ?? null,
    languages: lawyer.languages.map((l) => l.language.name),
    yearsExperience: lawyer.yearsExperience,
    verifiedCredentials: lawyer.verifiedCredentials,
    rating: lawyer.rating,
    consultationOptions: lawyer.consultationOptions,
  };
}

export function templateLawyerExplanation(
  lawyer: LawyerWithRelations,
  extracted: ExtractedFilters,
): string {
  const parts: string[] = [];
  const areas = lawyer.practiceAreas.map((p) => p.practiceArea.name);
  const userArea = extracted.practiceArea;
  const matchedArea = areas.find(
    (a) => userArea && a.toLowerCase().includes(userArea.replace("_", " ")),
  );
  if (matchedArea) parts.push(`Practises ${matchedArea}`);
  else if (areas[0]) parts.push(`Practises ${areas[0]}`);

  const city = lawyer.locations[0]?.city;
  if (city && (extracted.city?.toLowerCase() === city.toLowerCase() || !extracted.city))
    parts.push(`based in ${city}`);

  const langs = lawyer.languages.map((l) => l.language.name);
  const requested = (extracted.languages ?? []).map((x) => x.toLowerCase());
  const matchedLang = langs.find((l) => requested.includes(l.toLowerCase()));
  if (matchedLang) parts.push(`speaks ${matchedLang}`);

  if (lawyer.verifiedCredentials) parts.push("with verified credentials");
  if (lawyer.yearsExperience > 0) parts.push(`${lawyer.yearsExperience}+ years experience`);

  if (parts.length === 0) return `Listed in our directory.`;
  return capitalize(parts.join(", ")) + ".";
}

// =============================================================================
// SRA organisation explanation
// =============================================================================

async function explainOrg(org: SraOrgLite, extracted: ExtractedFilters): Promise<string> {
  const record = compactOrgRecord(org);
  const fallback = templateOrgExplanation(org);
  try {
    const content = await chat(
      [
        { role: "system", content: ORG_PROMPT },
        {
          role: "user",
          content: `USER_QUERY_TOPIC: ${extracted.semanticQuery}\nFIRM_RECORD: ${JSON.stringify(record)}\nWrite the explanation.`,
        },
      ],
      { temperature: 0.2, maxTokens: 70 },
    );
    const candidate = content.trim().replace(/^["'\s]+|["'\s]+$/g, "");
    return validateOrgExplanation(candidate, org) ?? fallback;
  } catch (err) {
    console.warn("[agent.explainer] org LLM call failed, using template:", err);
    return fallback;
  }
}

function compactOrgRecord(org: SraOrgLite) {
  return {
    businessName: org.businessName,
    city: org.city || null,
    county: org.county || null,
    country: org.country || null,
    sraVerified: true,
  };
}

export function templateOrgExplanation(org: SraOrgLite): string {
  if (org.city && org.city.trim()) return `SRA-verified firm in ${org.city.trim()}.`;
  if (org.country && org.country.trim()) return `SRA-verified firm in ${org.country.trim()}.`;
  return "SRA-verified UK firm.";
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
