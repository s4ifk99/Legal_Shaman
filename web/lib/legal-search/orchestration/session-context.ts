import type { FundingPreference } from "@/lib/legal-search/triage/types";

/** Snapshot of filters from a prior guided-search session (policy §8). */
export type SessionFilterSnapshot = {
  taxonomySlug: string | null;
  fundingPreference: FundingPreference;
  location?: string;
  postcode?: string;
  language?: string;
};

/**
 * Each new legal issue should start without inherited filters (policy §8).
 */
export function shouldStartFreshSession(
  _newQuery: string,
  _prior?: SessionFilterSnapshot | null,
): boolean {
  return true;
}

/**
 * Only suggest reusing filters when a prior snapshot exists and differs from defaults.
 */
export function shouldSuggestReusePreviousFilters(
  prior?: SessionFilterSnapshot | null,
): boolean {
  if (!prior) return false;
  const hasFilters =
    Boolean(prior.taxonomySlug) ||
    prior.fundingPreference !== "unsure" ||
    Boolean(prior.location) ||
    Boolean(prior.postcode) ||
    Boolean(prior.language);
  return hasFilters;
}

export function reuseFiltersPrompt(): string {
  return "Reuse filters from your last search?";
}
