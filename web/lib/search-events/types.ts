import { z } from "zod";

export const SEARCH_EVENT_TYPES = [
  "result_impression",
  "result_click",
  "contact_cta_click",
  "phone_click",
  "website_click",
  "map_marker_click",
  "result_save",
  "no_result_search",
  "refinement_click",
] as const;

export type SearchEventType = (typeof SEARCH_EVENT_TYPES)[number];

export const SEARCH_EVENT_PAGES = [
  "directory",
  "matcher",
  "find_a_lawyer",
  "category",
  "map",
] as const;

export type SearchEventPage = (typeof SEARCH_EVENT_PAGES)[number];

export const RESULT_SOURCES = [
  "curated_listing",
  "legal_aid",
  "sra",
  "lawyer",
  "firm",
] as const;

export type SearchResultSource = (typeof RESULT_SOURCES)[number];

export const SearchEventInputSchema = z.object({
  sessionId: z.string().trim().min(8).max(128),
  searchInteractionId: z.string().trim().min(1).max(64).optional(),
  query: z.string().trim().max(500).optional(),
  parsedPracticeArea: z.string().trim().max(64).optional(),
  parsedLocation: z.string().trim().max(128).optional(),
  resultId: z.string().trim().max(128).optional(),
  resultSource: z.enum(RESULT_SOURCES).optional(),
  resultRank: z.number().int().min(0).max(500).optional(),
  eventType: z.enum(SEARCH_EVENT_TYPES),
  page: z.enum(SEARCH_EVENT_PAGES),
  metadata: z.record(z.unknown()).optional(),
});

export type SearchEventInput = z.infer<typeof SearchEventInputSchema>;

/** Business rules enforced by POST /api/search/events (eval-safe). */
export function validateSearchEventBusinessRules(
  input: SearchEventInput,
): string | null {
  const needsResult =
    input.eventType !== "no_result_search" && input.eventType !== "refinement_click";
  if (needsResult && (!input.resultId || !input.resultSource)) {
    return "resultId and resultSource required for this event type";
  }
  return null;
}

export function entityBoostKey(entitySource: string, entityId: string): string {
  return `${entitySource}:${entityId}`;
}
