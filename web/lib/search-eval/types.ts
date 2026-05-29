import type { ParsedQuery } from "@/lib/legal-search/types";
import type { SearchResponseDebug } from "@/lib/legal-search/search-diagnostics-types";
import type { FundingIntent } from "@/lib/legal-search/funding-intent";

export type SearchEvalChannel = "directory" | "matcher";

export type SearchEvalCase = {
  id: string;
  query: string;
  channel: SearchEvalChannel;
  expectedTaxonomySlug?: string;
  acceptableTaxonomySlugs?: string[];
  expectedPracticeAreas?: string[];
  acceptableEntityTypes?: string[];
  requiredTermsAny?: string[];
  requiredSourcesAny?: string[];
  expectedLocation?: string;
  shouldClarify: boolean;
  mustReturnResults: boolean;
  minRelevantInTopK: number;
  topK: number;
  expectedFundingIntent?: FundingIntent;
  maxLegalAidInTopK?: number;
  requirePrivateFacingInTopK?: boolean;
  expectCoverageNotice?: boolean;
  expectExternalPrivateSignpost?: boolean;
  forbidLegalAidMislabeledAsPrivate?: boolean;
  minSraInTopK?: number;
  forbiddenTermsNoneInTopK?: string[];
  forbiddenPracticeSlugsNoneInTopK?: string[];
  notes?: string;
};

export type EvalRetrievedHit = {
  rank: number;
  id: string;
  title: string;
  source: string;
  entityType?: string;
  practiceAreas: string[];
  categories: string[];
  practiceAreaSlugs?: string[];
  haystack: string;
  explanation: string;
  relevant: boolean;
  relevanceReasons: string[];
  scoreBreakdown?: Record<string, number>;
  retrievalSources?: string[];
};

export type SearchEvalCaseResult = {
  caseId: string;
  query: string;
  channel: SearchEvalChannel;
  passed: boolean;
  failures: string[];
  parsedQuery?: ParsedQuery;
  taxonomySlug?: string | null;
  taxonomyAccurate: boolean;
  clarified: boolean;
  clarificationAccurate: boolean;
  resultCount: number;
  relevantInTopK: number;
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  hasRefinementPrompt: boolean;
  mapMarkerRate: number;
  explanationSafetyPass: boolean;
  degradedModes: string[];
  fallbackTriggered: boolean;
  searchDebug?: SearchResponseDebug;
  hits: EvalRetrievedHit[];
  latencyMs: number;
  notes?: string;
};

export type SearchEvalAggregateMetrics = {
  caseCount: number;
  passedCount: number;
  failedCount: number;
  taxonomyAccuracy: number;
  clarificationAccuracy: number;
  noResultFailureRate: number;
  avgPrecisionAtK: number;
  avgRecallAtK: number;
  avgMrr: number;
  avgNdcgAtK: number;
  mapMarkerAvailabilityRate: number;
  explanationSafetyPassRate: number;
  passCriteriaMet: boolean;
};

export type SearchEvalReport = {
  generatedAt: string;
  stack: Record<string, unknown>;
  aggregate: SearchEvalAggregateMetrics;
  passCriteria: {
    taxonomyAccuracyMin: number;
    noResultFailureRateMax: number;
    explanationSafetyPassRateMin: number;
  };
  results: SearchEvalCaseResult[];
};
