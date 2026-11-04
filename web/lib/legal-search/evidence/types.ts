/** How sure the system is about a review, cost, or timescale fact. */
export type SystemConfidence = "high" | "low";

export type CostBand = "free" | "legal_aid" | "published_fee" | "unpublished";

/** Named citation shown beside a high-confidence fact (e.g. Google Maps, Trustpilot). */
export type EvidenceSourceCite = {
  name: string;
  url: string;
};

export type EvidenceFact = {
  label: string;
  confidence: SystemConfidence;
  sourceName?: string;
  sourceUrl?: string;
  /** When multiple review sources exist, cite each instead of blending into one unnamed average. */
  sources?: EvidenceSourceCite[];
  reviewStars?: number | null;
  reviewCount?: number | null;
  costBand?: CostBand;
  costMinPence?: number | null;
  costMaxPence?: number | null;
};

export type ProviderEvidence = {
  review: EvidenceFact;
  cost: EvidenceFact;
};

/** One dispute, once per completed search. Not a property of a firm. */
export type DisputeTimescale = {
  label: string;
  rangeText: string;
  confidence: SystemConfidence;
  sourceName?: string;
  sourceUrl?: string;
  matterLabel: string;
};

export type ApprovedReviewSignal = {
  entityId: string;
  signalType: string;
  value: string;
  sourceUrl?: string | null;
  sourceType?: string | null;
  status: string;
};

/** A price quoted on the provider's own page. Incomplete records are rejected. */
export type PublishedPriceRecord = {
  resultId: string;
  providerName: string;
  service: string;
  minPence: number;
  maxPence: number;
  currency: "GBP";
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) the page was checked. */
  checkedOn: string;
};

export type ReviewFilter = "all" | "verified" | "four_plus";

export type CostFilter = "all" | "free" | "legal_aid" | "published_fee" | "unpublished";

export type ResultEvidenceFilters = {
  reviews: ReviewFilter;
  cost: CostFilter;
};

export const DEFAULT_EVIDENCE_FILTERS: ResultEvidenceFilters = {
  reviews: "all",
  cost: "all",
};

export function systemConfidenceLabel(confidence: SystemConfidence): string {
  return confidence === "high" ? "System high confidence" : "System low confidence";
}
