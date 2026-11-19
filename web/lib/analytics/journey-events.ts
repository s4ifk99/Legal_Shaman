/**
 * Product journey events for the current V3 build.
 * Explicit captures only — autocapture stays off.
 * Safe no-ops when PostHog is not configured.
 */

export const JOURNEY_EVENTS = {
  /** Site entry / return */
  visit: "visit",
  returnVisit: "return_visit",

  /** Marketing landing (`/`) */
  landingViewed: "landing_viewed",
  landingCtaAsk: "landing_cta_ask_shaman",
  landingDirectoryClick: "landing_directory_click",

  /** Ask the Shaman V3 agent (`/ask-the-shaman`) */
  shamanOpened: "shaman_opened",
  shamanMessageSent: "shaman_message_sent",
  shamanPhaseChanged: "shaman_phase_changed",
  shamanDocumentUploaded: "shaman_document_uploaded",
  shamanOptionsShown: "shaman_options_shown",
  shamanPlanReady: "shaman_plan_ready",
  shamanResultsIntent: "shaman_results_intent",
  shamanRestart: "shaman_restart",

  /** Your case / results */
  myCaseViewed: "my_case_viewed",
  myCaseAuthPrompt: "my_case_auth_prompt",
  planViewed: "plan_viewed",
  briefPdfDownloaded: "brief_pdf_downloaded",
  briefPrintOpened: "brief_print_opened",
  briefEmailSent: "brief_email_sent",

  /** Financing tool */
  financingViewed: "financing_viewed",
  financingMapped: "financing_mapped",
} as const;

export type JourneyEvent = (typeof JOURNEY_EVENTS)[keyof typeof JOURNEY_EVENTS];

export const JOURNEY_STORAGE = {
  firstVisitAt: "ls_journey_first_visit_at",
  lastVisitAt: "ls_journey_last_visit_at",
} as const;
