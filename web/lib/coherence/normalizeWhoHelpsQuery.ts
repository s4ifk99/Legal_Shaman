/** Normalize a situation string for who-helps cache lookup keys (pure; safe for client). */
export function normalizeWhoHelpsQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\bwho helps\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
