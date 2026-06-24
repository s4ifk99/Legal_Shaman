import type { SearchResult } from "@/lib/legal-search/types";

/** Boroughs and common localities treated as Greater London for city filter "London". */
const GREATER_LONDON_LOCALITIES = new Set(
  [
    "london",
    "city of london",
    "westminster",
    "camden",
    "islington",
    "hackney",
    "tower hamlets",
    "greenwich",
    "lewisham",
    "southwark",
    "lambeth",
    "wandsworth",
    "hammersmith and fulham",
    "kensington and chelsea",
    "hammersmith",
    "fulham",
    "chelsea",
    "kensington",
    "hammersmith & fulham",
    "kensington & chelsea",
    "brent",
    "ealing",
    "hounslow",
    "richmond upon thames",
    "kingston upon thames",
    "merton",
    "sutton",
    "croydon",
    "bromley",
    "bexley",
    "havering",
    "redbridge",
    "waltham forest",
    "newham",
    "barking and dagenham",
    "haringey",
    "enfield",
    "barnet",
    "harrow",
    "hillingdon",
  ].map((s) => s.toLowerCase()),
);

function normalizeLocationText(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function isGreaterLondonSearch(needle: string): boolean {
  return needle === "london" || needle === "greater london";
}

export function matchesLocationFilter(result: SearchResult, location: string): boolean {
  const needle = normalizeLocationText(location);
  if (!needle) return true;

  const city = normalizeLocationText(result.location?.city);
  const label = normalizeLocationText(result.locationLabel);
  const postcode = normalizeLocationText(result.location?.postcode);
  const haystack = `${city} ${label} ${postcode} ${result.title} ${result.description ?? ""}`.toLowerCase();

  if (city.includes(needle) || label.includes(needle) || postcode.includes(needle)) {
    return true;
  }

  if (haystack.includes(needle)) return true;

  if (isGreaterLondonSearch(needle)) {
    if (label.includes("london") || city.includes("london")) return true;
    if (GREATER_LONDON_LOCALITIES.has(city)) return true;
    if (/^e\d|^n\d|^nw\d|^se\d|^sw\d|^w\d|^wc\d|^ec\d/.test(postcode.replace(/\s+/g, ""))) {
      return true;
    }
  }

  return false;
}

export function filterResultsByLocation(
  results: SearchResult[],
  location: string | undefined,
): SearchResult[] {
  const loc = location?.trim();
  if (!loc) return results;
  return results.filter((r) => matchesLocationFilter(r, loc));
}
