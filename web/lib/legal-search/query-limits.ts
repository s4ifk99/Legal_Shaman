/** Hard cap for Ask the Shaman / directory / matcher API bodies (Zod). */
export const MAX_SEARCH_QUERY_CHARS = 4000;

/**
 * Soft cap used for retrieval, classification, and LLM prompts.
 * Full text up to MAX_SEARCH_QUERY_CHARS is accepted; processing uses this slice.
 */
export const SEARCH_QUERY_PROCESS_CHARS = 2000;

export function normalizeSearchQuery(query: string): string {
  return query.trim().slice(0, MAX_SEARCH_QUERY_CHARS);
}

/** Truncate after normalize for retrieval / LLM (keeps head of long Reddit-style posts). */
export function processSearchQuery(query: string): string {
  return normalizeSearchQuery(query).slice(0, SEARCH_QUERY_PROCESS_CHARS);
}

export function searchQueryTooLongMessage(max = MAX_SEARCH_QUERY_CHARS): string {
  return `Query too long (max ${max} characters). Shorten your description or remove extra detail.`;
}
