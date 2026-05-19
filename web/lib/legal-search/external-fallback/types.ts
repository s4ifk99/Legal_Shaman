import type { FundingPreference, FundingRoute } from "@/lib/legal-search/triage/types";
import type { ParsedQuery } from "@/lib/legal-search/types";
import type { SearchResult } from "@/lib/legal-search/types";

export type ExternalFallbackSourceId =
  | "govuk_legal_aid"
  | "lawworks"
  | "advocate"
  | "citizens_advice"
  | "law_society"
  | "sra_register"
  | "web";

export type ExternalFallbackResult = {
  id: string;
  source: ExternalFallbackSourceId;
  title: string;
  description?: string;
  url: string;
  practiceAreas?: string[];
  location?: string;
  fundingType?: "legal_aid" | "pro_bono" | "free_advice" | "private" | "unknown";
  regulatedStatus?: "sra_regulated" | "unknown" | "not_regulated";
  confidence: number;
  verificationNotes: string[];
};

export type ExternalFallbackReason =
  | "zero_internal_results"
  | "low_internal_scores"
  | "empty_funding_route"
  | "sra_unavailable_private_request"
  | "missing_private_family_coverage"
  | "weak_coverage";

export const PRIVATE_DIRECTORY_FALLBACK_NOTICE =
  "We have limited private-firm listings for this search. These official directories can help you find regulated solicitors.";

export type ExternalFallbackDebug = {
  fallbackTriggered: boolean;
  fallbackReason: string;
  fallbackSourcesQueried: string[];
  externalResultsCount: number;
  verificationWarnings: string[];
};

export type ExternalFallbackPayload = {
  triggered: boolean;
  reasons: ExternalFallbackReason[];
  results: ExternalFallbackResult[];
  notice: string;
  debug: ExternalFallbackDebug;
};

export type FallbackSearchContext = {
  query: string;
  mergedQuery: string;
  parsed: ParsedQuery;
  fundingPreference: FundingPreference;
  fundingRoutes: FundingRoute[];
  location?: string | null;
  postcode?: string | null;
  taxonomySlug?: string | null;
  sraAvailable: boolean;
};

export type FallbackTriggerInput = {
  internalResults: SearchResult[];
  sections: { kind: FundingRoute; results: SearchResult[] }[];
  fundingRoutes: FundingRoute[];
  fundingPreference: FundingPreference;
  mergedQuery: string;
  parsed: ParsedQuery;
  sraAvailable: boolean;
  /** Minimum `scores.final` for top hit to count as strong (default 0.38). */
  scoreThreshold?: number;
  /** Index balance snapshot for private/family coverage checks. */
  catalog?: import("@/lib/search-index/index-balance-diagnostics").IndexBalanceReport | null;
};

export const EXTERNAL_FALLBACK_NOTICE =
  "We could not find enough matches in our directory, so we checked trusted external legal directories. Please verify availability, eligibility, and regulated status before contacting.";

export const EXTERNAL_SECTION_TITLE = "Trusted external directories";
