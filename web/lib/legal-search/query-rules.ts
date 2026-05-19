import type { ExtractedFilters } from "@/lib/agent/types";
import { ParsedQuery, ParsedQuerySchema } from "@/lib/legal-search/types";
import {
  enrichParsedQueryWithTaxonomy,
  inferPracticeAreaSlugFromText,
  matcherSlugForTaxonomySlug,
} from "@/lib/legal/taxonomy";
import {
  extractPostcode,
  parseLocationFromQuery,
} from "@/lib/legal-search/location";
import { detectFundingIntent } from "@/lib/legal-search/funding-intent";

/**
 * Deterministic query parsing (no LLM). Safe to import from CLI eval scripts.
 */
export function ruleBasedParse(rawText: string): ParsedQuery {
  const lower = rawText.toLowerCase();
  const loc = parseLocationFromQuery(rawText);
  const pc = loc.postcode ?? extractPostcode(rawText);
  const taxSlug = inferPracticeAreaSlugFromText(rawText);
  const matcherSlug = taxSlug ? matcherSlugForTaxonomySlug(taxSlug) : null;

  const fundingIntent = detectFundingIntent(rawText);

  let intent: ParsedQuery["intent"] = "browse";
  if (fundingIntent === "legal_aid" || fundingIntent === "free_help") intent = "find_legal_aid";
  else if (/\b(solicitor|lawyer|barrister|attorney)\b/i.test(rawText)) intent = "find_lawyer";
  else if (/\b(firm|practice|llp|limited)\b/i.test(rawText) && intent === "browse")
    intent = "find_firm";
  if (/\b(urgent|emergency|arrested|bail|today|now)\b/i.test(rawText)) intent = "emergency";

  const legalAidSignal =
    fundingIntent === "legal_aid" ||
    fundingIntent === "free_help" ||
    /\b(legal aid|pro bono|free advice|citizens advice)\b/i.test(lower);

  return enrichParsedQueryWithTaxonomy(
    ParsedQuerySchema.parse({
      rawText,
      legalIssue: rawText.slice(0, 200),
      practiceAreaSlug: matcherSlug ?? taxSlug ?? undefined,
      postcode: pc ?? null,
      location: loc.nearMe ? null : guessCityFromText(rawText),
      radiusMiles: loc.radiusMiles ?? null,
      legalAidSignal,
      fundingIntent,
      intent,
      semanticQuery: rawText.slice(0, 400),
      confidence: 0.45,
      entityPreference: "either",
    }),
  );
}

function guessCityFromText(text: string): string | null {
  const cities = [
    "london",
    "manchester",
    "birmingham",
    "leeds",
    "liverpool",
    "bristol",
    "sheffield",
    "edinburgh",
    "glasgow",
    "cardiff",
    "belfast",
    "nottingham",
    "newcastle",
  ];
  const lower = text.toLowerCase();
  for (const c of cities) {
    if (lower.includes(c)) return c.replace(/^\w/, (x) => x.toUpperCase());
  }
  return null;
}

/** Overlay LLM extraction on a taxonomy-enriched parse (matcher POST). */
export function overlayExtractionOnParsed(
  extracted: ExtractedFilters,
  raw: string,
  taxonomyParsed: ParsedQuery,
): ParsedQuery {
  return ParsedQuerySchema.parse({
    ...taxonomyParsed,
    rawText: raw,
    legalIssue: extracted.semanticQuery,
    practiceAreaSlug: extracted.practiceArea ?? taxonomyParsed.practiceAreaSlug,
    location: extracted.city?.trim() ? extracted.city.trim() : taxonomyParsed.location,
    postcode: extracted.postcode ?? taxonomyParsed.postcode,
    languagePreference: extracted.languages ?? taxonomyParsed.languagePreference,
    urgency: extracted.urgency ?? taxonomyParsed.urgency,
    budgetPreference: extracted.budgetPreference ?? taxonomyParsed.budgetPreference,
    legalAidSignal: Boolean(
      taxonomyParsed.legalAidSignal || extracted.budgetPreference === "legal_aid",
    ),
    fundingIntent:
      taxonomyParsed.fundingIntent ?? detectFundingIntent(extracted.semanticQuery || raw),
    semanticQuery: extracted.semanticQuery || taxonomyParsed.semanticQuery || raw,
    confidence: extracted.confidence,
    intent: "find_lawyer",
    jurisdiction: extracted.jurisdiction != null ? String(extracted.jurisdiction) : taxonomyParsed.jurisdiction,
  });
}

/** Map matcher extraction to unified ParsedQuery for API transparency. */
export function extractedToParsedQuery(e: ExtractedFilters, raw: string): ParsedQuery {
  return enrichParsedQueryWithTaxonomy(
    ParsedQuerySchema.parse({
      rawText: raw,
      legalIssue: e.semanticQuery,
      practiceAreaSlug: e.practiceArea ?? null,
      location: e.city ?? null,
      postcode: e.postcode ?? null,
      languagePreference: e.languages,
      urgency: e.urgency ?? null,
      budgetPreference: e.budgetPreference ?? null,
      legalAidSignal: e.budgetPreference === "legal_aid",
      fundingIntent: detectFundingIntent(e.semanticQuery || raw),
      intent: "find_lawyer",
      semanticQuery: e.semanticQuery || raw,
      confidence: e.confidence,
      jurisdiction: e.jurisdiction != null ? String(e.jurisdiction) : null,
      entityPreference: "either",
    }),
  );
}
