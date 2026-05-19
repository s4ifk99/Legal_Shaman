import type { ParsedQuery } from "@/lib/legal-search/types";

export type RetrievalSource =
  | "typesense"
  | "pgvector"
  | "ilike"
  | "taxonomy"
  | "legacy"
  | "meilisearch"
  | "fuse";

export type ResultDebugDiagnostics = {
  retrievalSources: RetrievalSource[];
  originalRankBySource?: Record<string, number>;
  scoreBreakdown: Record<string, number>;
  matchedPracticeAreas: string[];
  matchedTaxonomyTerms: string[];
  matchedLocationSignals: string[];
  matchedLanguageSignals: string[];
  distanceMiles?: number;
  vectorDistance?: number;
  keywordScore?: number;
  typesenseScore?: number;
  finalScore: number;
  explanationInputs: string[];
  warnings: string[];
  capabilityMatches?: string[];
  contactDataSource?: string;
  contactConfidence?: number;
  missingContactFields?: string[];
  enrichmentStatus?: string;
};

export type ClarificationDecision = "none" | "asked" | "skipped_filters";

export type SearchResponseDebug = {
  queryPrefix: string;
  parsedQuery: ParsedQuery;
  expandedSearchText?: string;
  taxonomyMatch?: { slug?: string; label?: string; confidence?: string };
  queryConfidence?: string;
  clarificationDecision?: ClarificationDecision;
  filtersApplied?: Record<string, unknown>;
  typesenseQueries?: unknown;
  searchedFields?: string[];
  fallbackTriggered?: boolean;
  taxonomyProjectionMatches?: string[];
  initialTypesenseHitCount?: number;
  finalHitCount?: number;
  retrievalSources?: string[];
  activeSearchEngine?: "typesense_unified" | "legacy";
  degradedModeWarnings: string[];
  resultCountsBySource: Record<string, number>;
  rerankerVersion: string;
  latencyMs: number;
  channel: "directory" | "matcher";
  /** Trusted external directory fallback (not mixed with internal hits). */
  externalFallbackTriggered?: boolean;
  externalFallbackReason?: string;
  externalFallbackSourcesQueried?: string[];
  externalResultsCount?: number;
  externalFallbackVerificationWarnings?: string[];
  triageCompletenessScore?: number;
  triageMissingFields?: string[];
  triageNextBestQuestion?: string;
  fundingRouteDecision?: string;
  urgencyDecision?: string;
  externalFallbackDecision?: string;
  fundingIntent?: string;
  sourceDiversityApplied?: boolean;
  sourceCaps?: { maxLegalAidInTopK: number; topK: number };
  preDiversificationSourceCounts?: Record<string, number>;
  postDiversificationSourceCounts?: Record<string, number>;
  legalAidBoostApplied?: boolean;
  legalAidBoostReason?: string;
  /** Optional ranking pipeline snapshots (admin tooling). */
  rankingStages?: RankingStageSnapshot[];
};

export type RankingStageSnapshot = {
  stage: string;
  top: { rank: number; id: string; title: string; source: string; final: number; keyword: number }[];
};

export const DIRECTORY_RERANKER_VERSION = "directory-v4-capabilities";
export const MATCHER_RERANKER_VERSION = "matcher-v2";

/** Client-safe: strip debug fields from a cloned payload (for eval / tests). */
export function stripSearchDebugPayload(payload: {
  searchDebug?: SearchResponseDebug;
  results?: Array<{ debug?: ResultDebugDiagnostics } & Record<string, unknown>>;
  unifiedResults?: Array<{ debug?: ResultDebugDiagnostics } & Record<string, unknown>>;
}): typeof payload {
  const next = { ...payload };
  delete next.searchDebug;
  if (next.results) {
    next.results = next.results.map(({ debug: _d, ...rest }) => rest);
  }
  if (next.unifiedResults) {
    next.unifiedResults = next.unifiedResults.map(({ debug: _d, ...rest }) => rest);
  }
  return next;
}
