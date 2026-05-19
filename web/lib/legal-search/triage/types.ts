import type { ParsedQuery } from "@/lib/legal-search/types";
import type { SearchResult } from "@/lib/legal-search/types";
import type { SearchResponseDebug } from "@/lib/legal-search/search-diagnostics-types";
import type { ExternalFallbackPayload } from "@/lib/legal-search/external-fallback/types";
import type { TriageCompletenessReport } from "@/lib/legal-search/triage/completeness";

export type { TriageCompletenessReport } from "@/lib/legal-search/triage/completeness";

export type TriageConfidence = "low" | "medium" | "high";

export type FundingPreference =
  | "legal_aid"
  | "pro_bono"
  | "fixed_fee"
  | "private"
  | "unsure";

export type ClientType = "individual" | "business" | "charity" | "unsure";

export type FundingRoute =
  | "legal_aid"
  | "pro_bono"
  | "private"
  | "mixed";

export type RiskFlag =
  | "police"
  | "prison"
  | "domestic_abuse"
  | "eviction"
  | "immigration_removal"
  | "child_protection"
  | "homelessness"
  | "detention"
  | "court_deadline";

export type UrgencyLevel = "normal" | "elevated" | "urgent";

export type TriageAnswers = {
  subIssue?: string;
  location?: string;
  postcode?: string;
  fundingPreference?: FundingPreference;
  clientType?: ClientType;
  language?: string;
  accessibility?: string;
  courtOrDeadline?: "yes" | "no" | "unsure";
  /** Low-confidence flow: immediate danger / emergency (MCQ). */
  emergencyDanger?: "yes" | "no" | "unsure";
};

export type TriageState = {
  sessionId: string;
  initialQuery: string;
  mergedQuery: string;
  answers: Partial<TriageAnswers>;
  stepsCompleted: string[];
  taxonomySlug: string | null;
  confidence: TriageConfidence;
  fundingRoutes: FundingRoute[];
  fundingPreference: FundingPreference;
  urgency: UrgencyLevel;
  riskFlags: RiskFlag[];
  clientType: ClientType;
};

export type TriageQuestionChip = {
  id: string;
  label: string;
  value: string;
};

export type TriageQuestion = {
  field: keyof TriageAnswers | "subIssue";
  prompt: string;
  chips?: TriageQuestionChip[];
  allowSkip: boolean;
};

export type TriageSectionKind = "legal_aid" | "pro_bono" | "private";

export type TriageResultSection = {
  kind: TriageSectionKind;
  title: string;
  results: SearchResult[];
};

export type UrgentSignposting = {
  level: UrgencyLevel;
  headline: string;
  body: string;
  emergencyContacts?: { label: string; detail: string }[];
};

export type TriageQuestionResponse = {
  kind: "triage_question";
  triageState: TriageState;
  question: TriageQuestion;
  parsedQuery?: ParsedQuery;
  completeness?: TriageCompletenessReport;
  searchDebug?: SearchResponseDebug;
  disclaimer: string;
};

export type TriageResultsResponse = {
  kind: "triage_results";
  triageState: TriageState;
  fundingRoutes: FundingRoute[];
  sections: TriageResultSection[];
  /** Separate from internal `sections` — trusted external signposts only. */
  externalFallback?: ExternalFallbackPayload;
  /** Shown when private/SRA family coverage in the index is limited. */
  coverageNotice?: string;
  urgentSignposting?: UrgentSignposting;
  nextQuestion?: TriageQuestion;
  completeness?: TriageCompletenessReport;
  parsedQuery: ParsedQuery;
  markers: { id: string; lat: number; lng: number; title: string }[];
  degradedModes: string[];
  searchDebug?: SearchResponseDebug;
  disclaimer: string;
};

export type TriageResponse = TriageQuestionResponse | TriageResultsResponse;

export const TRIAGE_DISCLAIMER =
  "This tool helps you find legal providers. It does not provide legal advice. Always check eligibility and availability with the organisation directly.";

/** Source category labels for indexing and grouping. */
export type SourceCategory =
  | "sra_firm"
  | "legal_aid_provider"
  | "pro_bono_organisation"
  | "law_centre"
  | "advice_charity"
  | "university_law_clinic"
  | "curated_lawyer"
  | "curated_firm";

export const LEGAL_AID_ENTITY_TYPES = [
  "legal_aid_provider",
  "law_centre",
] as const;

export const PRO_BONO_ENTITY_TYPES = [
  "pro_bono_organisation",
  "advice_charity",
  "university_law_clinic",
] as const;

export const PRIVATE_ENTITY_TYPES = [
  "sra_organisation",
  "lawyer",
  "firm",
  "curated_listing",
] as const;
