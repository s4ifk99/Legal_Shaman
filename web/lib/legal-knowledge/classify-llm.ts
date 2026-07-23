import "server-only";

import { z } from "zod";

import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import { allTaxonomySlugs } from "@/lib/legal/natural-language-resolver";
import type { LegalIssueResolution } from "@/lib/legal/taxonomy";
import { chat, llmConfigured } from "@/lib/llm/client";

export type LlmLegalClassification = {
  taxonomySlug: string;
  specificIssue?: string;
  confidence: number;
  semanticQuery: string;
  searchBoostTerms: string[];
  clarifyingQuestion?: string;
};

const LlmClassificationSchema = z.object({
  taxonomySlug: z.string(),
  specificIssue: z.string().optional(),
  confidence: z.number().min(0).max(1),
  semanticQuery: z.string(),
  searchBoostTerms: z.array(z.string()).max(10).optional(),
  clarifyingQuestion: z.string().nullable().optional(),
});

import {
  enableLlmLegalClassificationFlag,
  legalClassifyRuleStrongThreshold,
  LLM_CLASSIFY_ACCEPT_THRESHOLD,
} from "./classify-config";

export function enableLlmLegalClassification(): boolean {
  if (!enableLlmLegalClassificationFlag()) return false;
  return llmConfigured();
}

export function shouldTriggerLlmClassification(
  resolution: LegalIssueResolution | null,
): boolean {
  if (!enableLlmLegalClassification() || !llmConfigured()) return false;
  const threshold = legalClassifyRuleStrongThreshold();
  if (!resolution) return true;
  return resolution.matchStrength < threshold;
}

function normalizeSlug(slug: string): string | null {
  const norm = slug.trim().toLowerCase().replace(/\s+/g, "_");
  const slugs = new Set(allTaxonomySlugs());
  if (slugs.has(norm)) return norm;
  const entry = LEGAL_ISSUE_TAXONOMY.find(
    (e) => e.slug === norm || e.matcherSlug === norm || e.canonicalName.toLowerCase() === norm,
  );
  return entry?.slug ?? null;
}

/** OpenRouter JSON classifier for UK legal issue taxonomy (hybrid path only). */
export async function classifyLegalIssueWithLlm(
  query: string,
  ruleResolution: LegalIssueResolution | null,
): Promise<LlmLegalClassification | null> {
  if (!enableLlmLegalClassification() || !llmConfigured()) return null;

  const slugList = allTaxonomySlugs().join(", ");
  const ruleHint = ruleResolution
    ? `Rule-based guess: ${ruleResolution.taxonomySlug} (strength ${ruleResolution.matchStrength.toFixed(2)}).`
    : "Rule-based guess: none.";

  try {
    const content = await chat(
      [
        {
          role: "system",
          content: `You classify UK legal search queries into a taxonomy slug for signposting (not legal advice).
Return JSON only with keys: taxonomySlug, specificIssue?, confidence (0-1), semanticQuery, searchBoostTerms (3-8 UK legal terms), clarifyingQuestion?
taxonomySlug MUST be one of: ${slugList}
specificIssue: short label e.g. "prenuptial agreement", "deposit dispute".
semanticQuery: expanded phrase for retrieval (max 200 chars).
Never give legal advice.`,
        },
        {
          role: "user",
          content: `${ruleHint}\n\nQuery: ${query.slice(0, 800)}`,
        },
      ],
      {
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 450,
        model: process.env.LLM_SMALL_MODEL?.trim() || undefined,
      },
    );

    const parsed = LlmClassificationSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;

    const taxonomySlug = normalizeSlug(parsed.data.taxonomySlug);
    if (!taxonomySlug) return null;

    return {
      taxonomySlug,
      specificIssue: parsed.data.specificIssue?.trim() || undefined,
      confidence: parsed.data.confidence,
      semanticQuery: parsed.data.semanticQuery?.trim() || query,
      searchBoostTerms: (parsed.data.searchBoostTerms ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 3)
        .slice(0, 8),
      clarifyingQuestion: parsed.data.clarifyingQuestion?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

export { LLM_CLASSIFY_ACCEPT_THRESHOLD as LLM_ACCEPT_THRESHOLD };
