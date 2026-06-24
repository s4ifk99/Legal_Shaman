import "server-only";

import { mergeAndRankDirectoryHits } from "@/lib/legal-search/hybrid-search";
import type { SearchFacets } from "@/lib/search/rerank";
import { parseQuery } from "@/lib/legal-search/query-understanding";
import { sortByFinalScore } from "@/lib/legal-search/ranking";
import { rerankSearchResults } from "@/lib/legal-search/rerank";
import { attachExplanations } from "@/lib/legal-search/explanations";
import type { DirectorySearchParams, DirectorySearchResponse, SearchResult } from "@/lib/legal-search/types";
import { rowMatchesPracticeTaxonomySlug } from "@/lib/legal/taxonomy";
import { toLegacyGetResponse } from "@/lib/legal-search/legacy-get-response";
import { finalizeDirectoryDiagnostics } from "@/lib/legal-search/search-diagnostics";
import { repairDirectorySearchResponse } from "@/lib/sra/runtime-name-repair";
import {
  applyVagueParsedQueryUx,
  detectVagueLegalQuery,
} from "@/lib/legal-search/vague-query-rescue";
import { usePostgresDirectorySearch } from "@/lib/legal-search/config";
import { getSearchStackStatus } from "@/lib/legal-search/search-startup";
import { filterResultsByLocation } from "@/lib/search/location-filter";

function buildFacets(p: DirectorySearchParams): SearchFacets | undefined {
  if (!p.freeOnly && !p.legalAidOnly && !p.city) return undefined;
  return {
    freeOnly: p.freeOnly || undefined,
    legalAidOnly: p.legalAidOnly || undefined,
    city: p.city || undefined,
  };
}

function filterByParams(
  results: SearchResult[],
  p: DirectorySearchParams,
  opts?: { vagueQueryMode?: boolean },
): SearchResult[] {
  let out = results;
  if (p.source === "sra") out = out.filter((r) => r.source === "sra");
  if (p.source === "legal_aid") out = out.filter((r) => r.source === "legal_aid");
  if (p.source === "curated") out = out.filter((r) => r.source === "curated_listing");
  if (p.practiceArea && !opts?.vagueQueryMode) {
    const slug = p.practiceArea.toLowerCase();
    out = out.filter((r) => {
      const hay = `${r.title} ${r.description ?? ""} ${r.practiceAreas.join(" ")} ${r.categories.join(" ")}`;
      return (
        rowMatchesPracticeTaxonomySlug(slug, hay) ||
        r.practiceAreas.some((x) => x.toLowerCase().includes(slug.replace(/_/g, " "))) ||
        r.categories.some((c) => c.toLowerCase().includes(slug.replace(/_/g, " ")))
      );
    });
  }
  if (p.location) {
    out = filterResultsByLocation(out, p.location);
  }
  if (p.language) {
    const lang = p.language.toLowerCase();
    out = out.filter((r) => r.languages?.some((l) => l.toLowerCase().includes(lang)));
  }
  if (p.verifiedOnly) {
    out = out.filter((r) => r.verified === true);
  }
  return out;
}

/** Legacy directory path (Fuse/Typesense listings + Meili SRA + HF vectors). */
export async function runDirectorySearchLegacy(
  params: DirectorySearchParams,
): Promise<DirectorySearchResponse> {
  const t0 = Date.now();
  const facets = buildFacets(params);
  let parsed = await parseQuery(params.query);
  const vagueQueryMode = detectVagueLegalQuery(parsed, {
    cityFilter: params.city,
    locationFilter: params.location,
    practiceAreaFilter: params.practiceArea,
    languageFilter: params.language,
    verifiedOnly: params.verifiedOnly,
    legalAidOnly: params.legalAidOnly,
  });
  if (vagueQueryMode) parsed = applyVagueParsedQueryUx(parsed);
  const retrieval = parsed.expandedSearchText?.trim() || params.query;
  let degradedModes: string[] = [];
  let results: SearchResult[];

  const stack = await getSearchStackStatus();
  const needsSraFromDb =
    !usePostgresDirectorySearch() &&
    (stack.degradedModeWarnings.includes("typesense_unreachable") ||
      stack.degradedModeWarnings.includes("legal_entities_collection_missing") ||
      stack.degradedModeWarnings.includes("legal_entities_empty"));

  if (usePostgresDirectorySearch()) {
    degradedModes.push("postgres_directory");
  } else if (needsSraFromDb) {
    degradedModes.push("postgres_sra_fallback");
  }

  const merged = await mergeAndRankDirectoryHits({
    query: params.query,
    limit: Math.min(120, Math.max(params.limit, 40)),
    semantic: params.semantic,
    facets,
    includeSra: true,
    parsed,
  });
  results = merged.results;
  degradedModes = [...degradedModes, ...merged.degradedModes];

  results = filterByParams(results, params, { vagueQueryMode });
  if (params.origin) {
    results = rerankSearchResults(results, parsed, { origin: params.origin });
  }
  results = sortByFinalScore(results);
  const preRankIndexById = new Map<string, number>();
  results.forEach((r, i) => preRankIndexById.set(r.id, i + 1));
  const off = params.offset ?? 0;
  const lim = params.limit ?? 40;
  results = results.slice(off, off + lim);
  results = attachExplanations(results, parsed);

  const finalized = finalizeDirectoryDiagnostics(
    {
      results,
      legacyRows: toLegacyGetResponse(results),
      degradedModes,
      parsedQuery: parsed,
      latencyMs: Date.now() - t0,
    },
    params.query,
    { preRankIndexById },
  );
  return repairDirectorySearchResponse(finalized);
}
