/**
 * Search auth gate — optional sign-in before search.
 * Off by default (Nov Exp 2: search before sign-up). Opt in with
 * REQUIRE_SEARCH_AUTH=true / NEXT_PUBLIC_REQUIRE_SEARCH_AUTH=true.
 * Soft wall still applies for bookmarks / notes.
 */
export function requireSearchAuthEnabled(): boolean {
  const server = process.env.REQUIRE_SEARCH_AUTH?.trim().toLowerCase();
  const pub = process.env.NEXT_PUBLIC_REQUIRE_SEARCH_AUTH?.trim().toLowerCase();
  const raw = server || pub;
  if (!raw) return false;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes";
}
