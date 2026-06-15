import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { reciprocalRankFusion } from "@/lib/search/rrf";

export type LegalEntitiesSearchParams = {
  q: string;
  expandedQ: string;
  limit: number;
  filterBy?: string;
  geoSortLat?: number;
  geoSortLng?: number;
};

export type LegalEntitiesHit = {
  document: Record<string, unknown>;
  textMatch?: number;
};

/** Weighted query_by — use with matching `query_by_weights` (Typesense does not accept `field:N` in query_by). */
export const LEGAL_ENTITIES_QUERY_BY =
  "title,practiceAreaSlugs,issueAliases,legalTerms,userSearchText,userPhrases,capabilitySearchText,expandedSearchText,legalSearchText,subIssues,practiceAreas,relatedPracticeAreas,taxonomyAliases,categories,searchText,description,provenanceSearchText,geoSearchText,city,postcode";

export const LEGAL_ENTITIES_QUERY_BY_WEIGHTS =
  "4,4,3,3,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1";

export const LEGAL_ENTITIES_QUERY_BY_EXPANDED =
  "expandedSearchText,userSearchText,legalSearchText,issueAliases,legalTerms,userPhrases,capabilitySearchText,searchText,taxonomyAliases,relatedPracticeAreas,practiceAreaSlugs,subIssues,practiceAreas,categories";

export const LEGAL_ENTITIES_QUERY_BY_EXPANDED_WEIGHTS =
  "2,2,2,2,2,2,1,1,1,1,1,1,1,1";

export const LEGAL_ENTITIES_QUERY_BY_EXACT =
  "exactTitle,exactPostcode,exactSraId,exactCity,title,sraId";

export const LEGAL_ENTITIES_QUERY_BY_EXACT_WEIGHTS = "3,4,4,2,1,1";

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i;
const SRA_ID_RE = /^\d{5,8}$/;

const LEGAL_TRIAGE_RE =
  /\b(dismissal|eviction|tribunal|divorce|asylum|redundancy|harassment|landlord|benefits|immigration|criminal|prison|housing|employment|neighbour|sacked|fired|arrested)\b/i;

/** Firm names, postcodes, SRA IDs — not vague legal-issue queries. */
export function isExactMatchStyleQuery(q: string): boolean {
  const t = q.trim();
  if (t.length < 2 || LEGAL_TRIAGE_RE.test(t)) return false;
  if (UK_POSTCODE_RE.test(t)) return true;
  if (SRA_ID_RE.test(t.replace(/\s/g, ""))) return true;
  if (/\b(LLP|Ltd|Limited|Solicitors?|Lawyers?|Law Firm|Chambers|& Co)\b/i.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 5 && t.length <= 72) {
    if (/\b(need|help|find|looking|advice|lawyer|solicitor)\b/i.test(t)) return false;
    return true;
  }
  return false;
}

function normaliseExactQuery(q: string): string {
  const pc = q.match(UK_POSTCODE_RE)?.[1];
  if (pc) return pc.replace(/\s+/g, "").toUpperCase();
  return q.trim().toLowerCase();
}

function escapeFilterValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

export function buildFilterBy(parts: {
  entityTypes?: string[];
  legalAidOnly?: boolean;
  verifiedOnly?: boolean;
  city?: string;
  source?: string;
  practiceArea?: string;
  extra?: string;
}): string | undefined {
  const clauses: string[] = [];
  if (parts.entityTypes?.length) {
    const list = parts.entityTypes.map((t) => `\`${escapeFilterValue(t)}\``).join(",");
    clauses.push(`entityType:=[${list}]`);
  }
  if (parts.legalAidOnly) clauses.push("legalAid:=true");
  if (parts.verifiedOnly) clauses.push("verified:=true");
  if (parts.city?.trim()) {
    clauses.push(`city:=\`${escapeFilterValue(parts.city.trim())}\``);
  }
  if (parts.source === "sra") clauses.push("entityType:=`sra_organisation`");
  if (parts.source === "legal_aid") clauses.push("entityType:=`legal_aid_provider`");
  if (parts.source === "curated") clauses.push("entityType:=`curated_listing`");
  if (parts.source === "private") {
    clauses.push("entityType:=[`lawyer`,`firm`,`sra_organisation`,`curated_listing`]");
  }
  if (parts.extra) clauses.push(parts.extra);
  return clauses.length ? clauses.join(" && ") : undefined;
}

export function buildGeoFilter(args: {
  lat: number;
  lng: number;
  radiusKm: number;
}): string {
  return `locationPoint:(${args.lat}, ${args.lng}, ${args.radiusKm} km)`;
}

/** Shared RRF merge for arbitrary legal_entities multi_search payloads. */
export async function performLegalEntitiesMultiSearch(
  searches: Record<string, unknown>[],
  limit: number,
): Promise<{ hits: LegalEntitiesHit[]; degradedModes: string[] }> {
  const degradedModes: string[] = [];
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) {
    degradedModes.push("typesense_not_configured");
    return { hits: [], degradedModes };
  }

  const normalized = searches.map((s) => ({
    collection: LEGAL_ENTITIES_COLLECTION,
    ...s,
  }));

  try {
    const res = await client.multiSearch.perform({ searches: normalized });
    const results = (res as { results?: { hits?: { document: Record<string, unknown>; text_match?: number }[] }[] })
      .results;
    const idLists: string[][] = [];
    const docMap = new Map<string, LegalEntitiesHit>();

    for (const r of results ?? []) {
      const ids: string[] = [];
      for (const h of r.hits ?? []) {
        const id = String(h.document?.id ?? "");
        if (!id) continue;
        ids.push(id);
        const prev = docMap.get(id);
        const tm = h.text_match ?? 0;
        if (!prev || tm > (prev.textMatch ?? 0)) {
          docMap.set(id, { document: h.document, textMatch: tm });
        }
      }
      if (ids.length) idLists.push(ids);
    }

    const fused = reciprocalRankFusion(idLists, 60);
    const hits: LegalEntitiesHit[] = [];
    for (const id of fused) {
      const hit = docMap.get(id);
      if (hit) hits.push(hit);
      if (hits.length >= limit) break;
    }
    return { hits, degradedModes };
  } catch (e) {
    degradedModes.push("typesense_search_failed");
    console.warn("[typesense-legal-entities-search]", e);
    return { hits: [], degradedModes };
  }
}

export async function searchLegalEntitiesMulti(
  params: LegalEntitiesSearchParams,
): Promise<{ hits: LegalEntitiesHit[]; degradedModes: string[] }> {
  const common = {
    per_page: Math.min(100, params.limit),
    filter_by: params.filterBy,
  };

  const searches: Record<string, unknown>[] = [
    {
      ...common,
      q: params.q,
      query_by: LEGAL_ENTITIES_QUERY_BY,
      query_by_weights: LEGAL_ENTITIES_QUERY_BY_WEIGHTS,
      typo_tolerance: true,
    },
    {
      ...common,
      q: params.expandedQ,
      query_by: LEGAL_ENTITIES_QUERY_BY_EXPANDED,
      query_by_weights: LEGAL_ENTITIES_QUERY_BY_EXPANDED_WEIGHTS,
      typo_tolerance: true,
    },
  ];

  if (isExactMatchStyleQuery(params.q)) {
    searches.push({
      ...common,
      q: normaliseExactQuery(params.q),
      query_by: LEGAL_ENTITIES_QUERY_BY_EXACT,
      query_by_weights: LEGAL_ENTITIES_QUERY_BY_EXACT_WEIGHTS,
      typo_tolerance: false,
      drop_tokens_threshold: 0,
    });
  }

  if (
    params.geoSortLat != null &&
    params.geoSortLng != null &&
    Number.isFinite(params.geoSortLat)
  ) {
    searches.push({
      ...common,
      q: params.q || "*",
      query_by: LEGAL_ENTITIES_QUERY_BY,
      query_by_weights: LEGAL_ENTITIES_QUERY_BY_WEIGHTS,
      sort_by: `locationPoint(${params.geoSortLat}, ${params.geoSortLng}):asc`,
    });
  }

  return performLegalEntitiesMultiSearch(searches, params.limit);
}

export async function searchLegalEntitiesForMatcher(args: {
  expandedQ: string;
  limit: number;
  filterBy?: string;
}): Promise<LegalEntitiesHit[]> {
  const { hits } = await searchLegalEntitiesMulti({
    q: args.expandedQ.slice(0, 200),
    expandedQ: args.expandedQ,
    limit: args.limit,
    filterBy: args.filterBy,
  });
  return hits;
}
