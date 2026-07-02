import "server-only";

import { z } from "zod";
import { chat, llmConfigured } from "@/lib/llm/client";
import {
  EntityPreferenceSchema,
  ParsedQuery,
  ParsedQuerySchema,
  SearchIntentSchema,
} from "@/lib/legal-search/types";
import { enableLlmSearch } from "@/lib/legal-search/config";
import { allTaxonomySlugs } from "@/lib/legal/natural-language-resolver";
import { enrichParsedQueryWithTaxonomy } from "@/lib/legal/taxonomy";
import {
  extractedToParsedQuery,
  ruleBasedParse,
} from "@/lib/legal-search/query-rules";

const LlmParsedSchema = z.object({
  legalIssue: z.string().optional(),
  practiceAreaSlug: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  postcode: z.string().nullable().optional(),
  radiusMiles: z.number().nullable().optional(),
  urgency: z.enum(["low", "normal", "high"]).nullable().optional(),
  languagePreference: z.array(z.string()).max(5).optional(),
  budgetPreference: z
    .enum(["free", "legal_aid", "fixed_fee", "any"])
    .nullable()
    .optional(),
  legalAidSignal: z.boolean().optional(),
  entityPreference: EntityPreferenceSchema.optional(),
  jurisdiction: z.string().nullable().optional(),
  intent: SearchIntentSchema,
  semanticQuery: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * LLM-assisted + deterministic fallback query understanding.
 */
export async function parseQuery(raw: string): Promise<ParsedQuery> {
  const rawText = raw.trim();
  if (rawText.length < 2) {
    return enrichParsedQueryWithTaxonomy(
      ParsedQuerySchema.parse({
        rawText,
        intent: "unclear",
        semanticQuery: rawText || " ",
      }),
    );
  }

  if (enableLlmSearch() && llmConfigured()) {
    try {
      const content = await chat(
        [
          {
            role: "system",
            content: `You extract structured search intent for a UK legal directory (not legal advice).
Return JSON only with keys: legalIssue?, practiceAreaSlug?, location?, postcode?, radiusMiles?, urgency?, languagePreference?, budgetPreference?, legalAidSignal?, entityPreference? ("individual"|"organisation"|"either"), jurisdiction?, intent, semanticQuery, confidence?
intent one of: browse, find_lawyer, find_legal_aid, find_firm, emergency, unclear.
practiceAreaSlug optional — use the closest taxonomy slug from: ${allTaxonomySlugs().join(", ")}.
Never give legal advice in output.`,
          },
          { role: "user", content: rawText.slice(0, 800) },
        ],
        { jsonMode: true, temperature: 0.1, maxTokens: 500 },
      );
      const json = JSON.parse(content) as unknown;
      const p = LlmParsedSchema.safeParse(json);
      if (p.success) {
        const merged = {
          rawText,
          ...p.data,
          semanticQuery: p.data.semanticQuery?.trim() || rawText,
        };
        const full = ParsedQuerySchema.safeParse(merged);
        if (full.success) return enrichParsedQueryWithTaxonomy(full.data);
      }
    } catch {
      // fall through
    }
  }

  return ruleBasedParse(rawText);
}

export { extractedToParsedQuery, ruleBasedParse, overlayExtractionOnParsed } from "@/lib/legal-search/query-rules";
