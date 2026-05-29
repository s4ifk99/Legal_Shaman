import { z } from "zod";
import type { ResultDebugDiagnostics, SearchResponseDebug } from "@/lib/legal-search/search-diagnostics-types";
import { FundingIntentSchema } from "@/lib/legal-search/funding-intent";

/** Provenance of a unified hit. */
export const SearchSourceSchema = z.enum([
  "lawyer",
  "firm",
  "sra",
  "legal_aid",
  "curated_listing",
]);

export type SearchSource = z.infer<typeof SearchSourceSchema>;

export type SearchResultLocation = {
  city?: string;
  postcode?: string;
  country?: string;
  lat?: number;
  lng?: number;
};

export type SearchResultScores = {
  keyword: number;
  semantic: number;
  location: number;
  practiceArea: number;
  jurisdiction: number;
  language: number;
  authority: number;
  freshness: number;
  /** Normalized cross-encoder reranker score when ENABLE_OPEN_RERANKER is on. */
  reranker?: number;
  final: number;
};

/**
 * Canonical hit returned by the unified legal search engine.
 * GET /api/search maps this to legacy JSON; POST matcher keeps LawyerMatch/OrgMatch plus optional parsedQuery.
 */
export type SearchResult = {
  id: string;
  source: SearchSource;
  title: string;
  description?: string;
  practiceAreas: string[];
  categories: string[];
  location?: SearchResultLocation;
  jurisdictions?: string[];
  languages?: string[];
  contact?: {
    phone?: string;
    email?: string;
    website?: string;
  };
  url?: string;
  verified?: boolean;
  rating?: number;
  availability?: string;
  raw: unknown;
  scores: SearchResultScores;
  explanation: string;
  warnings?: string[];
  /** adl | adlGroup | sra — for legacy GET mapping */
  legacyKind?: "adl" | "adlGroup" | "sra";
  /** Group id when legacyKind is adlGroup */
  firmGroupId?: string;
  /** Present only when ENABLE_SEARCH_DEBUG / development diagnostics are enabled. */
  debug?: ResultDebugDiagnostics;
};

export const SearchIntentSchema = z.enum([
  "browse",
  "find_lawyer",
  "find_legal_aid",
  "find_firm",
  "emergency",
  "unclear",
]);

export type SearchIntent = z.infer<typeof SearchIntentSchema>;

export const EntityPreferenceSchema = z.enum([
  "individual",
  "organisation",
  "either",
]);

export type EntityPreference = z.infer<typeof EntityPreferenceSchema>;

export const QueryConfidenceSchema = z.enum(["high", "medium", "low"]);

export const ParsedQuerySchema = z.object({
  rawText: z.string(),
  legalIssue: z.string().optional(),
  practiceAreaSlug: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  postcode: z.string().nullable().optional(),
  radiusMiles: z.number().min(1).max(200).nullable().optional(),
  urgency: z.enum(["low", "normal", "high"]).nullable().optional(),
  languagePreference: z.array(z.string()).max(5).optional(),
  budgetPreference: z
    .enum(["free", "legal_aid", "fixed_fee", "any"])
    .nullable()
    .optional(),
  legalAidSignal: z.boolean().optional(),
  fundingIntent: FundingIntentSchema.optional(),
  entityPreference: EntityPreferenceSchema.optional(),
  jurisdiction: z.string().nullable().optional(),
  intent: SearchIntentSchema,
  semanticQuery: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  taxonomySlug: z.string().nullable().optional(),
  taxonomyPrimaryLabel: z.string().optional(),
  taxonomyRelatedLabels: z.array(z.string()).max(16).optional(),
  expandedSearchText: z.string().optional(),
  queryConfidence: QueryConfidenceSchema.optional(),
  refinementQuestion: z.string().nullable().optional(),
  refinementChips: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        value: z.string(),
      }),
    )
    .max(8)
    .optional(),
  taxonomySummary: z.string().optional(),
});

export type ParsedQuery = z.infer<typeof ParsedQuerySchema>;
export type QueryConfidenceLevel = z.infer<typeof QueryConfidenceSchema>;

export type SearchChannel = "directory" | "matcher";

export type DirectorySearchParams = {
  query: string;
  limit: number;
  semantic: boolean;
  /** Legacy facet query params */
  freeOnly?: boolean;
  legalAidOnly?: boolean;
  city?: string;
  /** Optional unified filters (GET query string) */
  source?: string;
  practiceArea?: string;
  location?: string;
  radius?: number;
  language?: string;
  verifiedOnly?: boolean;
  offset?: number;
  /** Admin / tooling: attach full search debug even when ENABLE_SEARCH_DEBUG is off. */
  forceSearchDebug?: boolean;
  /** Admin / tooling: record ranking stage snapshots in searchDebug.rankingStages. */
  includeRankingStages?: boolean;
};

export type DirectorySearchResponse = {
  results: SearchResult[];
  legacyRows: unknown[];
  degradedModes: string[];
  parsedQuery: ParsedQuery;
  latencyMs: number;
  searchDebug?: SearchResponseDebug;
  /** Shown when broad taxonomy search returns related-area results only. */
  vagueRescueNotice?: string;
  /** Shown when private/family coverage is sparse in the index. */
  coverageNotice?: string;
  externalFallback?: import("@/lib/legal-search/external-fallback/types").ExternalFallbackPayload;
};

export const DISCLAIMER_UNIFIED =
  "This is not legal advice. Results are based on directory information and your search criteria.";
