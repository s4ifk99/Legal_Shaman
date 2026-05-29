import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";
import type { ExtractedFieldCandidate } from "@/lib/provider-crawler/types";

/** Full public-source ladder (priority order). */
export type OsintSourceStep =
  | "sra_register"
  | "law_society"
  | "govuk_legal_aid"
  | "official_website"
  | "lawworks_probono"
  | "curated_source"
  | "manual_review";

export type OsintWebsiteCandidate = {
  url: string;
  confidence: number;
  sourceType: EnrichmentSourceType;
  sourceUrl: string;
  provenanceNote: string;
  needsReview: boolean;
  domainScore: number;
};

export type StructuredDirectoryMatch = {
  sourceType: EnrichmentSourceType;
  sourceUrl: string;
  provenanceNote: string;
  confidence: number;
  title: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  postcode?: string;
  city?: string;
  practiceAreas?: string[];
  openingHours?: string;
  legalAid?: boolean;
  freeConsultation?: boolean;
};

export type OsintRunStats = {
  structuredMatches: number;
  websiteCandidates: number;
  fieldsSubmitted: number;
  pendingReview: number;
  autoApproved: number;
  rejected: number;
};

export type OsintFieldBundle = {
  candidates: ExtractedFieldCandidate[];
  website?: OsintWebsiteCandidate;
};
