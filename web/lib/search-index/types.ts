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
  categories: string[];
  subIssues: string[];
  searchText: string;
  expandedSearchText: string;
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
};
