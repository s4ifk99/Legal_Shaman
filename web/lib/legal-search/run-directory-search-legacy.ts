import "server-only";

import { unifiedSearchListings } from "@/lib/search/unified-search";
import type { SearchFacets } from "@/lib/search/rerank";
import { mergeAndRankDirectoryHits } from "@/lib/legal-search/hybrid-search";
import { parseQuery } from "@/lib/legal-search/query-understanding";
import { rankSearchResults, sortByFinalScore } from "@/lib/legal-search/ranking";
import { loadBehaviouralSignalsForEntities } from "@/lib/search-events/load-ranking-signals";
import { attachExplanations } from "@/lib/legal-search/explanations";
import { fromUnifiedHit } from "@/lib/legal-search/adapters/listing-adapter";
import type { DirectorySearchParams, DirectorySearchResponse, SearchResult } from "@/lib/legal-search/types";
import { enableUnifiedDirectory } from "@/lib/legal-search/config";
import { rowMatchesPracticeTaxonomySlug } from "@/lib/legal/taxonomy";
import { toLegacyGetResponse } from "@/lib/legal-search/legacy-get-response";
import { finalizeDirectoryDiagnostics } from "@/lib/legal-search/search-diagnostics";
import { repairDirectorySearchResponse } from "@/lib/sra/runtime-name-repair";
import {
  applyVagueParsedQueryUx,
  detectVagueLegalQuery,
} from "@/lib/legal-search/vague-query-rescue";
import { getSearchStackStatus } from "@/lib/legal-search/search-startup";

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
    const loc = p.location.toLowerCase();
    out = out.filter((r) => r.location?.city?.toLowerCase().includes(loc));
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
    stack.degradedModeWarnings.includes("typesense_unreachable") ||
    stack.degradedModeWarnings.includes("legal_entities_collection_missing") ||
    stack.degradedModeWarnings.includes("legal_entities_empty");

  if (enableUnifiedDirectory() || needsSraFromDb) {
    const merged = await mergeAndRankDirectoryHits({
      query: params.query,
      limit: Math.min(120, Math.max(params.limit, 40)),
      semantic: params.semantic,
      facets,
      includeSra: true,
      parsed,
    });
    results = merged.results;
    degradedModes = merged.degradedModes;
  } else {
    const hits = await unifiedSearchListings(params.query, {
      limit: params.limit,
      semantic: params.semantic,
      facets,
      retrievalQuery: retrieval,
    });
    results = hits.map((h) => fromUnifiedHit(h, parsed));
    const behaviouralSignals = await loadBehaviouralSignalsForEntities(
      results.map((r) => ({ id: r.id, source: r.source })),
      { practiceArea: parsed.practiceAreaSlug, city: parsed.location },
    );
    results = rankSearchResults(results, parsed, { behaviouralSignals });
  }

  results = filterByParams(results, params, { vagueQueryMode });
  if (enableUnifiedDirectory()) {
    results = sortByFinalScore(results);
  }
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
