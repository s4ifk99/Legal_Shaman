import {
  DEFAULT_EVIDENCE_FILTERS,
  type CostFilter,
  type EvidenceFact,
  type ProviderEvidence,
  type ResultEvidenceFilters,
  type ReviewFilter,
} from "@/lib/legal-search/evidence/types";

const REVIEW_FILTERS = new Set<ReviewFilter>(["all", "verified", "four_plus"]);
const COST_FILTERS = new Set<CostFilter>(["all", "free", "legal_aid", "published_fee", "unpublished"]);

export function evidenceFiltersFromQuery(input: {
  reviews?: string;
  cost?: string;
}): ResultEvidenceFilters {
  const reviews = REVIEW_FILTERS.has(input.reviews as ReviewFilter)
    ? (input.reviews as ReviewFilter)
    : DEFAULT_EVIDENCE_FILTERS.reviews;
  const cost = COST_FILTERS.has(input.cost as CostFilter)
    ? (input.cost as CostFilter)
    : DEFAULT_EVIDENCE_FILTERS.cost;
  return { reviews, cost };
}

function reviewMatches(review: EvidenceFact, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  if (review.confidence !== "high") return false;
  if (review.reviewStars == null || review.reviewCount == null || review.reviewCount <= 0) return false;
  if (filter === "verified") return true;
  return review.reviewStars >= 4;
}

function costMatches(cost: EvidenceFact, filter: CostFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unpublished") {
    return cost.confidence !== "high" || cost.costBand === "unpublished";
  }
  return cost.confidence === "high" && cost.costBand === filter;
}

export function evidenceMatchesFilters(
  evidence: ProviderEvidence | undefined,
  filters: ResultEvidenceFilters,
): boolean {
  if (filters.reviews === "all" && filters.cost === "all") return true;
  if (!evidence) {
    return filters.reviews === "all" && (filters.cost === "all" || filters.cost === "unpublished");
  }
  return reviewMatches(evidence.review, filters.reviews) && costMatches(evidence.cost, filters.cost);
}

/** True when a hidden card failed because the filtered fact is not known, not because a known fact missed the bar. */
export function hiddenBecauseUnknown(
  evidence: ProviderEvidence | undefined,
  filters: ResultEvidenceFilters,
): boolean {
  if (evidenceMatchesFilters(evidence, filters)) return false;
  const review = evidence?.review;
  const cost = evidence?.cost;
  const reviewUnknown = !review || review.confidence !== "high";
  const costUnknown = !cost || cost.confidence !== "high";
  if (filters.reviews !== "all" && !reviewMatches(review ?? { label: "", confidence: "low" }, filters.reviews)) {
    if (reviewUnknown) return true;
  }
  if (
    filters.cost !== "all" &&
    filters.cost !== "unpublished" &&
    !costMatches(cost ?? { label: "", confidence: "low" }, filters.cost)
  ) {
    if (costUnknown) return true;
  }
  return false;
}

export function countHiddenUnknown<T>(
  items: T[],
  evidenceOf: (item: T) => ProviderEvidence | undefined,
  filters: ResultEvidenceFilters,
): number {
  let count = 0;
  for (const item of items) {
    const evidence = evidenceOf(item);
    if (!evidenceMatchesFilters(evidence, filters) && hiddenBecauseUnknown(evidence, filters)) {
      count += 1;
    }
  }
  return count;
}
