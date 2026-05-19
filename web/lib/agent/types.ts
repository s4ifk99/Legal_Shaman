import { z } from "zod";
import type { MapMarker } from "@/lib/search/map-results";
import type { MapBounds } from "@/lib/search/location";
import type {
  ResultDebugDiagnostics,
  SearchResponseDebug,
} from "@/lib/legal-search/search-diagnostics-types";

export const PRACTICE_AREA_SLUGS = [
  "employment",
  "immigration",
  "family",
  "criminal_defence",
  "personal_injury",
  "commercial",
] as const;

export type PracticeAreaSlug = (typeof PRACTICE_AREA_SLUGS)[number];

export const JURISDICTIONS = [
  "England & Wales",
  "Scotland",
  "Northern Ireland",
] as const;

export type Jurisdiction = (typeof JURISDICTIONS)[number];

/**
 * Structured filters the agent extracts from a free-text legal-issue description.
 * Every field is optional — confidence reflects how grounded the extraction is.
 */
export const ExtractedFiltersSchema = z.object({
  practiceArea: z.enum(PRACTICE_AREA_SLUGS).nullable().optional(),
  city: z.string().trim().min(1).max(64).nullable().optional(),
  postcode: z.string().trim().min(2).max(12).nullable().optional(),
  jurisdiction: z.enum(JURISDICTIONS).nullable().optional(),
  languages: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  urgency: z.enum(["low", "normal", "high"]).nullable().optional(),
  budgetPreference: z
    .enum(["free", "legal_aid", "fixed_fee", "any"])
    .nullable()
    .optional(),
  semanticQuery: z.string().trim().min(1).max(400),
  confidence: z.number().min(0).max(1),
});

export type ExtractedFilters = z.infer<typeof ExtractedFiltersSchema>;

/**
 * Optional hard filters applied client-side via the filters sidebar.
 * These are merged on top of the agent's extraction as strict SQL constraints.
 */
export const AppliedFiltersSchema = z.object({
  practiceArea: z.enum(PRACTICE_AREA_SLUGS).optional(),
  city: z.string().trim().min(1).max(64).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  freeConsultation: z.boolean().optional(),
  verifiedOnly: z.boolean().optional(),
});

export type AppliedFilters = z.infer<typeof AppliedFiltersSchema>;

export const AgentInputSchema = z.object({
  query: z.string().trim().min(2).max(800),
  sessionId: z.string().trim().min(1).max(128).optional(),
  appliedFilters: AppliedFiltersSchema.optional(),
});

export type AgentInput = z.infer<typeof AgentInputSchema>;

/** Map-ready location fields when verified coordinates exist. */
export type MatchLocation = {
  latitude: number;
  longitude: number;
  address?: string;
  city: string;
  postcode: string;
  locationLabel: string;
  distanceMiles?: number;
};

export type ScoreBreakdown = {
  total: number;
  practiceAreaMatch: number;
  locationProximity: number;
  jurisdictionMatch: number;
  languageMatch: number;
  verifiedCredentials: number;
  availability: number;
  rating: number;
  semantic: number;
};

/** Curated-lawyer match shape returned to the client. */
export type LawyerMatch = {
  kind: "lawyer";
  id: string;
  name: string;
  firm: string | null;
  /** Set when the firm is linked to an SRA-registered organisation. */
  firmSraVerified?: boolean;
  firmSraProfileUrl?: string | null;
  practiceAreas: { slug: string; name: string }[];
  city: string;
  jurisdiction: string;
  languages: string[];
  yearsExperience: number;
  rating: number;
  reviewCount: number;
  consultationOptions: string[];
  verifiedCredentials: boolean;
  profileUrl: string | null;
  /** Plain-text, 1-sentence explanation. Already guardrailed. */
  explanation: string;
  scoreBreakdown: ScoreBreakdown;
  location?: MatchLocation;
  mapMarker?: MapMarker;
  debug?: ResultDebugDiagnostics;
};

/** SRA-registered organisation match. Org cards link out to the SRA consumer profile. */
export type OrgMatch = {
  kind: "org";
  /** Stable id: `sra-<sraId>`. */
  id: string;
  sraId: string;
  businessName: string;
  city: string;
  postcode: string;
  country: string;
  /** Best-effort jurisdiction inferred from postcode area (may be ""). */
  jurisdiction: string;
  sraProfileUrl: string;
  explanation: string;
  scoreBreakdown: ScoreBreakdown;
  location?: MatchLocation;
  mapMarker?: MapMarker;
  debug?: ResultDebugDiagnostics;
};

export type AnyMatch = LawyerMatch | OrgMatch;

/** Backward-compat alias — earlier code imported `AgentMatch`. */
export type AgentMatch = AnyMatch;

export type AgentResult =
  | { kind: "clarify"; question: string; disclaimer: string; searchDebug?: SearchResponseDebug }
  | {
      kind: "matches";
      results: AnyMatch[];
      markers: MapMarker[];
      markerCount: number;
      missingCoordinateCount: number;
      bounds?: MapBounds;
      disclaimer: string;
      extracted: ExtractedFilters;
      searchDebug?: SearchResponseDebug;
      /** Optional refinement when practice area is clear but sub-issue or location is open (taxonomy medium confidence). */
      refinementQuestion?: string;
      taxonomySummary?: string;
    };

export const DISCLAIMER =
  "This is not legal advice. These matches are based on your search criteria.";
