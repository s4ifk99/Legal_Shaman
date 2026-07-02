/**
 * Legal-issue taxonomy (canonical areas, expansion, clarifications) + legacy practice slugs
 * for directory ranking and matcher SQL filters.
 */

import type { ParsedQuery, QueryConfidenceLevel } from "@/lib/legal-search/types";
import { ParsedQuerySchema } from "@/lib/legal-search/types";
import { detectFundingIntent } from "@/lib/legal-search/funding-intent";
import {
  LEGAL_ISSUE_TAXONOMY,
  type LegalIssueTaxonomyEntry,
} from "@/lib/legal/legal-issue-taxonomy-data";
import { resolveLegalIssueFromNaturalLanguage } from "@/lib/legal/natural-language-resolver";
import { refinementChipsFromEntry } from "@/lib/legal/refinement-chips";

export type { LegalIssueTaxonomyEntry };

export type LegalIssueResolution = {
  taxonomySlug: string;
  canonicalName: string;
  matcherSlug: string;
  relatedPracticeAreas: string[];
  expandedTerms: string[];
  clarificationQuestion: string | null;
  searchBoostTerms: string[];
  legalAidLikely: boolean;
  matchStrength: number;
};

/** Legacy shape: one row per taxonomy slug used in directory keyword inference. */
export type TaxonomyEntry = {
  slug: string;
  displayName: string;
  keywords: string[];
};

const byTaxonomySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));

function uniqueLower(strings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of strings) {
    const t = s.trim().toLowerCase();
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** All match phrases for an entry, longest first (substring scoring). */
function phrasesForEntry(e: LegalIssueTaxonomyEntry): string[] {
  return uniqueLower([
    ...e.aliases,
    ...e.userPhrases,
    ...e.subIssues,
    ...e.searchBoostTerms,
    e.canonicalName,
    e.slug.replace(/_/g, " "),
  ]).sort((a, b) => b.length - a.length);
}

/** Score query text against taxonomy; pick best legal issue from natural language. */
export function resolveLegalIssueFromQuery(raw: string): LegalIssueResolution | null {
  return resolveLegalIssueFromNaturalLanguage(raw);
}

export function computeQueryConfidence(
  raw: string,
  resolution: LegalIssueResolution | null,
  parsed: Pick<ParsedQuery, "location" | "postcode" | "intent">,
): QueryConfidenceLevel {
  const hasLocation = Boolean(parsed.location?.trim() || parsed.postcode?.trim());
  const trimmed = raw.trim();
  if (trimmed.length < 3) return "low";
  if (!resolution || resolution.matchStrength < 0.08) return "low";
  if (resolution.matchStrength >= 0.28 && hasLocation) return "high";
  if (resolution.matchStrength >= 0.2) return "medium";
  if (resolution.matchStrength >= 0.14) return "medium";
  if (hasLocation && resolution.matchStrength >= 0.12) return "medium";
  return "low";
}

/** Extra text appended for Typesense / vector retrieval (not shown as user query). */
export function buildExpandedSearchText(resolution: LegalIssueResolution | null, raw: string): string {
  if (!resolution) return raw.trim();
  const extra = [...resolution.searchBoostTerms, ...resolution.expandedTerms.slice(0, 8)]
    .filter((t) => !raw.toLowerCase().includes(t.toLowerCase()))
    .slice(0, 14)
    .join(" ");
  const base = raw.trim();
  if (!extra) return base;
  return `${base} ${extra}`.trim().slice(0, 900);
}

export function buildTaxonomySummary(resolution: LegalIssueResolution | null): string | null {
  if (!resolution) return null;
  const related = resolution.relatedPracticeAreas.slice(0, 5).join(", ");
  const tail = related ? ` Related areas: ${related}.` : "";
  return `Here are lawyers and organisations matching ${resolution.canonicalName}.${tail}`;
}

function collectKeywordsForMatcher(matcherSlug: string): string[] {
  const set = new Set<string>();
  for (const e of LEGAL_ISSUE_TAXONOMY) {
    if (e.matcherSlug !== matcherSlug) continue;
    for (const x of [
      ...e.aliases,
      ...e.userPhrases,
      ...e.subIssues,
      ...e.searchBoostTerms,
      e.canonicalName,
      e.slug.replace(/_/g, " "),
    ]) {
      const t = x.trim().toLowerCase();
      if (t.length > 1) set.add(t);
    }
  }
  return [...set];
}

function collectKeywordsForTaxonomySlug(slug: string): string[] {
  const e = byTaxonomySlug.get(slug);
  if (!e) return collectKeywordsForMatcher(slug);
  const out = new Set<string>();
  for (const x of [
    ...e.aliases,
    ...e.userPhrases,
    ...e.subIssues,
    ...e.searchBoostTerms,
    e.canonicalName,
    e.slug.replace(/_/g, " "),
  ]) {
    const t = x.trim().toLowerCase();
    if (t.length > 1) out.add(t);
  }
  return [...out];
}

/** Derive legacy PRACTICE_TAXONOMY rows (slug = directory taxonomy slug where distinct from matcher). */
export const PRACTICE_TAXONOMY: TaxonomyEntry[] = (() => {
  const bySlug = new Map<string, { displayName: string; keywords: Set<string> }>();
  for (const e of LEGAL_ISSUE_TAXONOMY) {
    const slug = e.slug;
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { displayName: e.canonicalName, keywords: new Set() });
    }
    const row = bySlug.get(slug)!;
    for (const kw of phrasesForEntry(e)) row.keywords.add(kw);
  }
  return [...bySlug.entries()].map(([slug, v]) => ({
    slug,
    displayName: v.displayName,
    keywords: [...v.keywords],
  }));
})();

const slugToName = new Map(PRACTICE_TAXONOMY.map((e) => [e.slug, e.displayName]));

/**
 * True when listing text aligns with a taxonomy slug OR matcher slug
 * (keywords from all legal issues in that bucket).
 */
export function rowMatchesPracticeTaxonomySlug(slug: string, haystack: string): boolean {
  const lower = haystack.toLowerCase();
  const kws = uniqueLower([
    ...collectKeywordsForTaxonomySlug(slug),
    ...collectKeywordsForMatcher(slug),
  ]);
  if (kws.some((kw) => lower.includes(kw))) return true;
  const slugPhrase = slug.replace(/_/g, " ");
  if (lower.includes(slugPhrase)) return true;
  return slugPhrase
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .some((p) => lower.includes(p));
}

/** Best taxonomy slug (legal issue id) from free text. */
export function inferPracticeAreaSlugFromText(q: string): string | null {
  const res = resolveLegalIssueFromQuery(q);
  return res?.taxonomySlug ?? null;
}

export function inferMatcherSlugFromText(q: string): string | null {
  return resolveLegalIssueFromQuery(q)?.matcherSlug ?? null;
}

export function displayNameForSlug(slug: string): string {
  return slugToName.get(slug) ?? slug.replace(/_/g, " ");
}

/** Map taxonomy / matcher slug to matcher DB practice area slug. */
export function matcherSlugForTaxonomySlug(slug: string): string | null {
  const e = byTaxonomySlug.get(slug);
  if (e) return e.matcherSlug;
  const direct = LEGAL_ISSUE_TAXONOMY.find((x) => x.matcherSlug === slug);
  if (direct) return direct.matcherSlug;
  const map: Record<string, string> = {
    employment: "employment",
    immigration: "immigration",
    family: "family",
    criminal_defence: "criminal_defence",
    personal_injury: "personal_injury",
    housing: "family",
    neighbour_dispute: "family",
    wills_probate: "family",
    conveyancing: "commercial",
    commercial: "commercial",
  };
  return map[slug] ?? null;
}

/**
 * Merge taxonomy resolution + confidence into a parsed query object.
 */
export function enrichParsedQueryWithTaxonomy(parsed: ParsedQuery): ParsedQuery {
  const raw = parsed.rawText ?? parsed.semanticQuery ?? "";
  const resolution = resolveLegalIssueFromQuery(raw);
  const hasEmergency =
    resolution &&
    resolution.matchStrength > 0 &&
    resolution.taxonomySlug &&
    LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === resolution.taxonomySlug)?.emergencySignals.some((s) =>
      raw.toLowerCase().includes(s.toLowerCase()),
    );

  const inferredMatcher = resolution?.matcherSlug ?? null;
  const inferredTaxonomy = resolution?.taxonomySlug ?? null;
  const practiceAreaSlug =
    parsed.practiceAreaSlug?.trim() ||
    (inferredMatcher ?? (inferredTaxonomy ? matcherSlugForTaxonomySlug(inferredTaxonomy) : null)) ||
    undefined;

  const expandedSearchText = buildExpandedSearchText(resolution, raw);
  const queryConfidence = computeQueryConfidence(raw, resolution, {
    location: parsed.location,
    postcode: parsed.postcode,
    intent: parsed.intent,
  });

  const refinementQuestion = resolution?.clarificationQuestion ?? null;
  const taxonomyEntry = resolution ? byTaxonomySlug.get(resolution.taxonomySlug) : undefined;

  const taxonomySummary = buildTaxonomySummary(resolution);

  const fundingIntent = parsed.fundingIntent ?? detectFundingIntent(raw);

  const refinementChips =
    queryConfidence === "medium" && taxonomyEntry
      ? refinementChipsFromEntry(taxonomyEntry)
      : parsed.refinementChips;

  return ParsedQuerySchema.parse({
    ...parsed,
    fundingIntent,
    practiceAreaSlug: practiceAreaSlug ?? parsed.practiceAreaSlug,
    taxonomySlug: inferredTaxonomy ?? parsed.taxonomySlug,
    taxonomyPrimaryLabel: resolution?.canonicalName ?? parsed.taxonomyPrimaryLabel,
    taxonomyRelatedLabels: resolution?.relatedPracticeAreas ?? parsed.taxonomyRelatedLabels,
    expandedSearchText,
    queryConfidence,
    refinementQuestion,
    refinementChips: refinementChips?.length ? refinementChips : undefined,
    taxonomySummary: taxonomySummary ?? parsed.taxonomySummary,
    legalAidSignal:
      parsed.legalAidSignal ||
      Boolean(resolution?.legalAidLikely && /\blegal\s*aid\b/i.test(raw.toLowerCase())),
    urgency: hasEmergency ? "high" : parsed.urgency,
  });
}
