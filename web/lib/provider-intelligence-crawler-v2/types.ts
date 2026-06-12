import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";

export const CRAWLER_V2_STAGES = [
  "discover_website",
  "extract_contacts",
  "extract_practice_areas",
  "extract_reviews",
  "ai_enrich",
] as const;

export type CrawlerV2Stage = (typeof CRAWLER_V2_STAGES)[number];

export type CrawlRunStatus = "queued" | "running" | "completed" | "failed" | "retry";

export type V2RecordStatus = "pending_review" | "auto_approved" | "approved" | "rejected";

export type V2ExtractionCandidate = {
  entityId: string;
  entityType: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceType: EnrichmentSourceType;
  sourceUrl?: string;
  extractionMethod: string;
  provenanceNote?: string;
  reviewCategory?: "field" | "testimonial" | "review_signal";
  /** Practice area label when field is practice_areas */
  practiceLabel?: string;
  practiceSlug?: string;
  /** Review signal type when applicable */
  signalType?: string;
  websiteCandidateType?: import("@/lib/provider-osint/website-candidate-types").WebsiteCandidateType;
  firmNameUsed?: string;
};

export type CrawlerV2BatchResult = {
  stage: CrawlerV2Stage;
  targets: number;
  runsCompleted: number;
  runsFailed: number;
  recordsWritten: number;
  autoApproved: number;
  queuedForModeration: number;
};

export type CrawlerV2RunStats = {
  candidatesSubmitted: number;
  autoApproved: number;
  pendingReview: number;
  rejected: number;
  errors: string[];
};

export type WebsiteDiscoveryDiagnostics = {
  candidatesFound: number;
  candidatesCollected: number;
  candidatesRejected: number;
  regulatoryRejected: number;
  directoryRejected: number;
  rejectedSynthetic: number;
  rejectedUnverified: number;
  noCandidate: number;
  firmNamesUsed: number;
  searchQueriesBuilt: number;
  searchResultsSeen: number;
  candidatesVerified: number;
};

export type WebsiteDiscoveryRunStats = CrawlerV2RunStats & WebsiteDiscoveryDiagnostics;

export type WebsiteDiscoveryBatchResult = CrawlerV2BatchResult &
  WebsiteDiscoveryDiagnostics & {
    pendingReview: number;
  };

export type PracticeAreaExtractionResult = CrawlerV2RunStats & {
  pagesFetched: number;
  servicePagesDetected: number;
  taxonomyMatches: number;
  approvedWebsite?: string;
  pendingWebsite?: string;
  skipReason?: string;
};

export type PracticeAreaDebugRow = {
  providerId: string;
  approvedWebsite: string | null;
  pendingWebsite: string | null;
  skipReason: string | null;
  pagesFetched: number;
  matches: number;
};

export type PracticeAreaBatchResult = CrawlerV2BatchResult & {
  selectedProviders: number;
  withApprovedWebsite: number;
  withPendingWebsite: number;
  skippedNoWebsite: number;
  fetchedPages: number;
  servicePagesDetected: number;
  taxonomyMatches: number;
  debugSamples?: PracticeAreaDebugRow[];
};
