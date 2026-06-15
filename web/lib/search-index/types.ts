/** Entity types in the unified Typesense `legal_entities` collection. */
export type EntityType =
  | "lawyer"
  | "firm"
  | "sra_organisation"
  | "legal_aid_provider"
  | "curated_listing"
  | "pro_bono_organisation"
  | "law_centre"
  | "advice_charity"
  | "university_law_clinic";

export type LegalEntityDocument = {
  id: string;
  entityType: EntityType;
  title: string;
  displayName?: string;
  organisationName?: string;
  tradingName?: string;
  firmName?: string;
  description: string;
  practiceAreas: string[];
  /** Projected + native taxonomy slugs (e.g. prison_law). */
  practiceAreaSlugs?: string[];
  /** Cross-area labels for vague-query matching (e.g. Prison Law on Criminal Defence firms). */
  relatedPracticeAreas?: string[];
  /** Aliases appended for retrieval (taxonomy + legal-aid expansions). */
  taxonomyAliases?: string[];
  /** Reasons projection ran (debug / index audit). */
  taxonomyProjectionMatches?: string[];
  /** SRA practice-area projection confidence (0–1), index-time only. */
  sraProjectionConfidence?: number;
  /** Employment slug projection confidence (0–1), index-time only. */
  employmentProjectionConfidence?: number;
  categories: string[];
  subIssues: string[];
  searchText: string;
  expandedSearchText: string;
  /** Plain-English triage phrases (index-time). */
  userSearchText?: string;
  /** Legal / taxonomy terms (index-time). */
  legalSearchText?: string;
  capabilitySearchText?: string;
  provenanceSearchText?: string;
  geoSearchText?: string;
  issueAliases?: string[];
  legalTerms?: string[];
  userPhrases?: string[];
  fundingTerms?: string[];
  urgencyTerms?: string[];
  tribunalTerms?: string[];
  languageTerms?: string[];
  accessibilityTerms?: string[];
  /** Normalised exact-match helpers. */
  exactTitle?: string;
  exactPostcode?: string;
  exactCity?: string;
  exactSraId?: string;
  /** 0–1 index richness (diagnostics / weak tie-break). */
  indexQualityScore?: number;
  source: string;

  city?: string;
  postcode?: string;
  country?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  locationPoint?: [number, number];

  jurisdictions?: string[];
  languages?: string[];
  legalAid: boolean;
  freeConsultation?: boolean;
  remoteConsultation?: boolean;
  verified?: boolean;
  sraId?: string;
  sraOrganisationId?: string;
  sraNumber?: string;
  firmId?: string;
  profileUrl?: string;
  website?: string;
  phone?: string;
  email?: string;
  /** Merged capability slugs (all categories). */
  capabilities?: string[];
  fundingCapabilities?: string[];
  urgencyCapabilities?: string[];
  accessibilityCapabilities?: string[];
  tribunalCapabilities?: string[];
  contactConfidence?: number;
  contactSource?: string;
  enrichmentStatus?: string;
  contactPageUrl?: string;
  openingHours?: string;
  /** 0–1 approved profile completeness (crawl/enrichment ladder). */
  providerCompletenessScore?: number;
  /** Internal: weak index/contact profile. */
  weakProvider?: boolean;
  /** Index-time only: lawyer consultation options from Prisma. */
  consultationOptions?: string[];

  authorityScore: number;
  profileCompletenessScore: number;
  rating?: number;
  reviewCount?: number;

  embedding?: number[];
  embedding1536?: number[];
  rawSourceId: string;
  updatedAt: number;
};

export type IndexSource =
  | "curated"
  | "legal_aid"
  | "lawyers"
  | "sra"
  | "probono"
  | "all";

export type SyncStats = {
  source: IndexSource;
  documentsBuilt: number;
  documentsUpserted: number;
  geocoded: number;
  skippedNoCoords: number;
  errors: string[];
  degraded?: boolean;
  resumeAfter?: string | null;
};
