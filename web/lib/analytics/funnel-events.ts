/**
 * November experiment funnel — explicit PostHog events only (no autocapture).
 * Weekly “user” for the 100/week target = a person who fires `search_completed`.
 * See docs/ops/weekly-user-definition.md
 */

export const FUNNEL_EVENTS = {
  visit: "visit",
  searchStarted: "search_started",
  searchCompleted: "search_completed",
  resultViewed: "result_viewed",
  providerSaved: "provider_saved",
  returnVisit: "return_visit",
  notePromptShown: "note_prompt_shown",
  noteSaved: "note_saved",
  privacyInterest: "privacy_upgrade_interest",
  privacyCheckout: "privacy_upgrade_checkout",
  comparisonViewed: "comparison_viewed",
  problemLandingViewed: "problem_landing_viewed",
} as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

export const FUNNEL_STORAGE = {
  firstVisitAt: "ls_funnel_first_visit_at",
  lastVisitAt: "ls_funnel_last_visit_at",
  utm: "ls_funnel_utm",
} as const;

export type UtmProps = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
};

export function readUtmFromSearch(search: string): UtmProps {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const out: UtmProps = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
}
