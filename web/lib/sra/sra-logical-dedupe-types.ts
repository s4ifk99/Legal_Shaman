import type { SraOrganisation } from "@prisma/client";

export type SraDedupeReason =
  | "exact_email_match"
  | "exact_website_domain_match"
  | "phone_postcode_match"
  | "exact_address_postcode_match"
  | "placeholder_address_matches_real_address";

export const DEDUPE_REASON_PRIORITY: Record<SraDedupeReason, number> = {
  exact_email_match: 1,
  exact_website_domain_match: 2,
  phone_postcode_match: 3,
  exact_address_postcode_match: 4,
  placeholder_address_matches_real_address: 5,
};

export type TransferredCounts = {
  provider_enrichments?: string[];
  provider_crawl_jobs?: string[];
  provider_crawl_results?: string[];
  provider_extracted_fields?: string[];
  provider_enrichment_states?: string[];
  provider_crawl_runs?: string[];
  provider_websites?: string[];
  provider_contacts?: string[];
  provider_practice_areas?: string[];
  provider_review_signals?: string[];
  indexing_jobs?: string[];
  search_ranking_signals?: string[];
  sra_identity_candidates?: string[];
};

export type SraDedupePairCandidate = {
  oldSraId: string;
  newSraId: string;
  reason: SraDedupeReason;
  matchKey: string;
};

export type SraDedupeExample = {
  oldSraId: string;
  newSraId: string;
  reason: SraDedupeReason;
  oldDisplayName: string;
  newDisplayName: string;
  skipped?: string;
};

export type SraLogicalDedupeReport = {
  examined: number;
  mergeable: number;
  skippedConflict: number;
  skippedWeakMatch: number;
  skippedBetterName: number;
  transferredEnrichments: number;
  deletedRows: number;
  dryRun: boolean;
  examples: SraDedupeExample[];
};

export type SraOrgSnapshot = Pick<
  SraOrganisation,
  | "id"
  | "sraId"
  | "businessName"
  | "displayName"
  | "organisationName"
  | "searchText"
  | "phone"
  | "email"
  | "website"
  | "postcode"
  | "city"
>;
