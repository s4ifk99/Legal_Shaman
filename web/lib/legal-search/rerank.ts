import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { rankSearchResults, sortByFinalScore, type RankSearchOptions } from "@/lib/legal-search/ranking";
import type { LatLng } from "@/lib/search/location";
import { distanceMiles } from "@/lib/search/location";
import type { VagueQueryRescuePlan } from "@/lib/legal-search/vague-query-rescue";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Second-stage directory rerank: base weighted scores plus optional geo proximity.
 */
export type RerankSearchOptions = { origin?: LatLng; vagueQueryMode?: boolean; vagueRescuePlan?: VagueQueryRescuePlan } &
  RankSearchOptions;

export function rerankSearchResults(
  results: SearchResult[],
  parsed: ParsedQuery,
  opts?: RerankSearchOptions,
): SearchResult[] {
  let out = rankSearchResults(results, parsed, opts);
  const origin = opts?.origin;
  if (!origin) return out;

  out = out.map((r) => {
    const lat = r.location?.lat;
    const lng = r.location?.lng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return r;
    }
    const miles = distanceMiles(origin, { lat, lng });
    const geoBoost = clamp01(1 - miles / 45);
    const scores = { ...r.scores };
    scores.location = Math.max(scores.location, geoBoost);
    scores.final = clamp01(scores.final + 0.1 * geoBoost);
    return { ...r, scores };
  });

  return out;
}

export { sortByFinalScore };
