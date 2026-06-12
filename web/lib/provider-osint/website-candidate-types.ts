export type WebsiteCandidateType =
  | "registry_supplied"
  | "search_result"
  | "page_verified"
  | "heuristic_guess";

export const SEARCH_RESULT_MODERATION_FLOOR = 0.75;
export const PAGE_VERIFIED_MODERATION_FLOOR = 0.85;

/** Only these types may be written to provider_enrichments / moderation queue. */
export function candidateMayEnterModeration(
  candidateType: WebsiteCandidateType,
  confidence: number,
): boolean {
  if (candidateType === "heuristic_guess") return false;
  if (candidateType === "registry_supplied") return true;
  if (candidateType === "search_result") return confidence >= SEARCH_RESULT_MODERATION_FLOOR;
  if (candidateType === "page_verified") return confidence >= PAGE_VERIFIED_MODERATION_FLOOR;
  return false;
}
