import type { WikiSearchHit } from "./search";

const HOUSING_REPAIR_QUERY =
  /\b(housing association|social housing|council (home|house|tenant|housing)|disrepair|repairs?|landlord|leak|damp|mould|mold|bathroom|kitchen|joint tenant|co-?tenant|awaab|hoarding|succession)\b/i;

const FAMILY_COHAB_TITLE =
  /\b(living together|cohabitation|common law marriage|prenup|prenuptial|divorce|marriage contract)\b/i;

const OFF_TOPIC_FOR_HOUSING =
  /\b(visa|immigration|child contact|custody|employment|commission|small claim|parkingeye)\b/i;

/** Prefer repair/HA pages and demote cohabitation hits when the query is about housing disrepair. */
export function rerankWikiHitsForQuery(query: string, hits: WikiSearchHit[]): WikiSearchHit[] {
  if (!HOUSING_REPAIR_QUERY.test(query)) return hits;

  return [...hits]
    .map((hit) => {
      const title = hit.title;
      let boost = 0;
      if (/\b(repair|disrepair|housing association|social housing|landlord|council)\b/i.test(title)) {
        boost += 55;
      }
      if (/\b(getting repairs|check if your landlord|complaining about your landlord)\b/i.test(title)) {
        boost += 35;
      }
      if (hit.category === "Home and Housing") boost += 25;
      if (FAMILY_COHAB_TITLE.test(title)) boost -= 100;
      if (OFF_TOPIC_FOR_HOUSING.test(title)) boost -= 60;
      if (hit.id.startsWith("Directory/Firms/")) boost -= 40;
      return { hit, score: hit.score + boost };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => ({ ...row.hit, score: row.score }));
}

export function housingRepairAnchors(query: string): string[] {
  const lower = query.toLowerCase();
  if (!HOUSING_REPAIR_QUERY.test(lower)) return [];
  return [
    "getting repairs done housing association",
    "check if your landlord has to do repairs",
    "social housing tenant repairs",
    "housing disrepair",
    "complaining landlord failure repairs social housing",
  ];
}

export function isHousingRepairQuery(query: string): boolean {
  return HOUSING_REPAIR_QUERY.test(query);
}
