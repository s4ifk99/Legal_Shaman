import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

export type WeakReason =
  | "no_phone"
  | "no_website"
  | "no_approved_email"
  | "no_practice_area_slugs"
  | "no_taxonomy_aliases"
  | "short_search_text"
  | "no_capabilities"
  | "no_location_point"
  | "low_index_quality";

export type WeakProviderRecord = {
  doc: LegalEntityDocument;
  reasons: WeakReason[];
  priorityScore: number;
  approvedEnrichments: ProviderEnrichment[];
};

export type WeakProviderReport = {
  totalWeak: number;
  totalScanned: number;
  weakBySource: Record<string, number>;
  weakByReason: Record<WeakReason, number>;
  weakByPracticeArea: Record<string, number>;
  topPriority: WeakProviderRecord[];
};

export type LadderSourceStep =
  | "sra_register"
  | "law_society"
  | "govuk_legal_aid"
  | "official_website"
  | "lawworks_probono"
  | "curated_source"
  | "approved_structured"
  | "manual_review";

export type EnrichmentPlan = {
  entityId: string;
  entityType: string;
  title: string;
  steps: LadderSourceStep[];
  missingFields: string[];
  priorityScore: number;
  website?: string;
  profileUrl?: string;
};

export type WebsiteDiscoveryCandidate = {
  url: string;
  confidence: number;
  sourceType:
    | "sra_register"
    | "law_society"
    | "govuk_legal_aid"
    | "provider_website"
    | "curated_source"
    | "external_directory";
  sourceUrl: string;
  provenanceNote: string;
  needsReview: boolean;
};

export type LadderExtractionStats = {
  entityId: string;
  status: string;
  candidatesSubmitted: number;
  pendingReview: number;
  autoApproved: number;
  rejected: number;
  errors: string[];
};
