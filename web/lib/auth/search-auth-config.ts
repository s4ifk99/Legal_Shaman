/**
 * Search auth gate — clients must sign in (or create an account) before search.
 * On by default. Opt out with REQUIRE_SEARCH_AUTH=false /
 * NEXT_PUBLIC_REQUIRE_SEARCH_AUTH=false.
 */
export function requireSearchAuthEnabled(): boolean {
  const server = process.env.REQUIRE_SEARCH_AUTH?.trim().toLowerCase();
  const pub = process.env.NEXT_PUBLIC_REQUIRE_SEARCH_AUTH?.trim().toLowerCase();
  const raw = server || pub;
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes";
}
