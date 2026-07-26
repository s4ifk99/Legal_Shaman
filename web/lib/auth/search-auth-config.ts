/**
 * Temporary search-auth gate.
 * Off by default until signup/login is solid again.
 * Re-enable with REQUIRE_SEARCH_AUTH=true and NEXT_PUBLIC_REQUIRE_SEARCH_AUTH=true.
 */
export function requireSearchAuthEnabled(): boolean {
  const server = process.env.REQUIRE_SEARCH_AUTH?.trim().toLowerCase();
  const pub = process.env.NEXT_PUBLIC_REQUIRE_SEARCH_AUTH?.trim().toLowerCase();
  const raw = server || pub;
  return raw === "1" || raw === "true" || raw === "yes";
}
