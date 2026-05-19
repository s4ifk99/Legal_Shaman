import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { detectFundingIntent, type FundingIntent } from "@/lib/legal-search/funding-intent";
import {
  isPrivateFacingSearchHit,
  sourceDiversityTier,
} from "@/lib/legal-search/source-diversity";
import type { IndexBalanceReport } from "@/lib/search-index/index-balance-diagnostics";

export const MISSING_PRIVATE_COVERAGE_NOTICE =
  "We currently have limited private-firm coverage for this area. These results may include legal aid providers and external directories.";

const PRIVATE_FAMILY_QUERY =
  /\b(private\s+(solicitor|lawyer|firm)|divorce\s+solicitor|family\s+solicitor|matrimonial\s+solicitor|good\s+divorce\s+lawyer|divorce\s+lawyer)\b/i;

const FAMILY_TAXONOMY = new Set(["family", "wills_probate"]);

export function queryWantsPrivateFamilyHelp(query: string, parsed: ParsedQuery): boolean {
  const text = `${query} ${parsed.semanticQuery}`;
  const intent = parsed.fundingIntent ?? detectFundingIntent(text);
  const taxonomy = parsed.taxonomySlug ?? parsed.practiceAreaSlug;
  const familySignal =
    (taxonomy && FAMILY_TAXONOMY.has(taxonomy)) ||
    /\b(divorce|matrimonial|family law|child arrangements|separation)\b/i.test(text);

  if (intent === "private") return true;
  if (PRIVATE_FAMILY_QUERY.test(text)) return true;
  if (familySignal && /\b(solicitor|lawyer|law firm)\b/i.test(text) && intent !== "legal_aid") {
    return true;
  }
  return false;
}

export function countPrivateFamilyInResults(results: SearchResult[]): number {
  let n = 0;
  for (const r of results) {
    const raw = r.raw as { practiceAreaSlugs?: string[]; entityType?: string } | null;
    const slugs = raw?.practiceAreaSlugs ?? [];
    const family =
      slugs.includes("family") ||
      /\b(family|divorce|matrimonial)\b/i.test(
        `${r.title} ${r.description ?? ""} ${r.practiceAreas.join(" ")}`,
      );
    if (family && isPrivateFacingSearchHit({ source: r.source, entityType: raw?.entityType })) {
      n++;
    }
  }
  return n;
}

export type PrivateCoverageAssessment = {
  wantsPrivateFamily: boolean;
  indexHasPrivateFamily: boolean;
  resultsHavePrivateFamily: boolean;
  showCoverageNotice: boolean;
  triggerPrivateExternalFallback: boolean;
  familyPrivateFacingCount: number | null;
};

export function assessPrivateCoverage(opts: {
  query: string;
  parsed: ParsedQuery;
  results: SearchResult[];
  catalog?: IndexBalanceReport | null;
}): PrivateCoverageAssessment {
  const wantsPrivateFamily = queryWantsPrivateFamilyHelp(opts.query, opts.parsed);
  const familyPrivateFacingCount = opts.catalog?.familyPrivateFacingCount ?? null;
  const indexHasPrivateFamily = (familyPrivateFacingCount ?? 0) > 0;
  const resultsHavePrivateFamily = countPrivateFamilyInResults(opts.results) > 0;

  const showCoverageNotice =
    wantsPrivateFamily && !indexHasPrivateFamily && opts.results.length > 0;

  const triggerPrivateExternalFallback =
    wantsPrivateFamily && !resultsHavePrivateFamily && opts.results.length > 0;

  return {
    wantsPrivateFamily,
    indexHasPrivateFamily,
    resultsHavePrivateFamily,
    showCoverageNotice,
    triggerPrivateExternalFallback,
    familyPrivateFacingCount,
  };
}

export function buildCoverageNotice(assessment: PrivateCoverageAssessment): string | undefined {
  if (!assessment.showCoverageNotice) return undefined;
  return MISSING_PRIVATE_COVERAGE_NOTICE;
}

/** Legal aid hits must not be described as private solicitors in user-facing copy. */
export function legalAidMislabeledAsPrivate(r: SearchResult): boolean {
  if (r.source !== "legal_aid" && sourceDiversityTier(r) !== "legal_aid") return false;
  const blob = `${r.title} ${r.description ?? ""} ${r.explanation}`.toLowerCase();
  return /\b(private solicitor|private lawyer|hire a private|regulated firm)\b/i.test(blob);
}
