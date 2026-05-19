import "server-only";

import { parseQuery } from "@/lib/legal-search/query-understanding";
import type { DirectorySearchParams, ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { attachExplanations } from "@/lib/legal-search/explanations";
import { rerankSearchResults, sortByFinalScore } from "@/lib/legal-search/rerank";
import { buildFilterBy, buildGeoFilter } from "@/lib/search-index/typesense-legal-entities-search";
import {
  enrichListingResultsFromIndex,
  legalEntityDocToSearchResult,
} from "@/lib/search-index/to-search-result";
import { runDirectorySearchLegacy } from "@/lib/legal-search/run-directory-search-legacy";
import { enableTypesenseUnified } from "@/lib/legal-search/config";
import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { typesenseServerHealth } from "@/lib/search-index/typesense-legal-entities-index";
import type { LatLng } from "@/lib/search/location";
import { distanceMiles } from "@/lib/legal-search/location";
import { rowMatchesPracticeTaxonomySlug } from "@/lib/legal/taxonomy";
import { toLegacyGetResponse } from "@/lib/legal-search/legacy-get-response";
import type { DirectorySearchResponse } from "@/lib/legal-search/types";
import { finalizeDirectoryDiagnostics } from "@/lib/legal-search/search-diagnostics";
import type { RankingStageSnapshot } from "@/lib/legal-search/search-diagnostics-types";
import { loadBehaviouralSignalsForEntities } from "@/lib/search-events/load-ranking-signals";
import {
  applyVagueParsedQueryUx,
  buildTaxonomyFallbackNotice,
  buildVagueQueryRescuePlan,
  countUsefulVagueResults,
  detectVagueLegalQuery,
  filterVagueRescueResults,
  getTaxonomyMatch,
  searchWithTaxonomyRescue,
} from "@/lib/legal-search/vague-query-rescue";
import { getSearchStackStatus } from "@/lib/legal-search/search-startup";
import { detectFundingIntent } from "@/lib/legal-search/funding-intent";
import { applySourceDiversity, type SourceDiversityDebug } from "@/lib/legal-search/source-diversity";
import {
  applyProviderCapabilityRanking,
  isUrgentSearchQuery,
} from "@/lib/provider-intelligence/provider-capability-ranker";
import { collectIndexBalanceReport } from "@/lib/search-index/index-balance-diagnostics";
import {
  assessPrivateCoverage,
  buildCoverageNotice,
} from "@/lib/legal-search/private-coverage";
import { runExternalFallback } from "@/lib/legal-search/external-fallback/web-search-client";
import { PRIVATE_DIRECTORY_FALLBACK_NOTICE } from "@/lib/legal-search/external-fallback/types";
import { groupResultsByFundingRoute } from "@/lib/legal-search/triage/result-router";
import { resolveFundingRouteOrder } from "@/lib/legal-search/orchestration/search-agent-policy";
import { detectFundingPreference } from "@/lib/legal-search/triage/funding-router";

export type TypesenseDirectoryOptions = DirectorySearchParams & {
  mapBounds?: { north: number; south: number; east: number; west: number };
  origin?: LatLng;
};

function snapshotRankingStage(stage: string, results: SearchResult[], k: number): RankingStageSnapshot {
  const sorted = [...results].sort((a, b) => b.scores.final - a.scores.final);
  return {
    stage,
    top: sorted.slice(0, k).map((r, i) => ({
      rank: i + 1,
      id: r.id,
      title: r.title.slice(0, 120),
      source: r.source,
      final: Math.round(r.scores.final * 1000) / 1000,
      keyword: Math.round(r.scores.keyword * 1000) / 1000,
    })),
  };
}

function countProjectionMatches(results: SearchResult[]): string[] {
  const reasons = new Set<string>();
  for (const r of results) {
    const raw = r.raw as { taxonomyProjectionMatches?: string[] } | null;
    for (const m of raw?.taxonomyProjectionMatches ?? []) reasons.add(m);
  }
  return [...reasons];
}

export async function runTypesenseDirectorySearch(
  params: TypesenseDirectoryOptions,
): Promise<DirectorySearchResponse> {
  const t0 = Date.now();
  const stack = await getSearchStackStatus();
  if (!enableTypesenseUnified() || stack.activeDirectoryEngine === "legacy") {
    if (stack.degradedModeWarnings.length) {
      console.warn(
        JSON.stringify({
          event: "directory_search_degraded",
          warnings: stack.degradedModeWarnings,
          query: params.query.slice(0, 80),
        }),
      );
    }
    const legacy = await runDirectorySearchLegacy(params);
    return {
      ...legacy,
      degradedModes: [...stack.degradedModeWarnings, ...legacy.degradedModes],
    };
  }

  let parsed = await parseQuery(params.query);
  const vagueDetectOpts = {
    cityFilter: params.city,
    locationFilter: params.location,
    practiceAreaFilter: params.practiceArea,
    languageFilter: params.language,
    verifiedOnly: params.verifiedOnly,
    legalAidOnly: params.legalAidOnly,
  };
  const vagueQueryMode = detectVagueLegalQuery(parsed, vagueDetectOpts);
  const rescuePlan = getTaxonomyMatch(parsed) ? buildVagueQueryRescuePlan(parsed) : null;
  if (vagueQueryMode) parsed = applyVagueParsedQueryUx(parsed);

  const degradedModes: string[] = [];
  const client = buildTypesenseListingsClientFromEnv();

  if (!client) {
    degradedModes.push("typesense_not_configured");
    const legacy = await runDirectorySearchLegacy(params);
    return { ...legacy, degradedModes: [...degradedModes, ...legacy.degradedModes] };
  }

  const health = await typesenseServerHealth(client);
  if (!health.ok) {
    degradedModes.push("typesense_unreachable");
    const legacy = await runDirectorySearchLegacy(params);
    return { ...legacy, degradedModes: [...degradedModes, ...legacy.degradedModes] };
  }

  try {
    await client.collections(LEGAL_ENTITIES_COLLECTION).retrieve();
  } catch {
    degradedModes.push("legal_entities_collection_missing");
    const legacy = await runDirectorySearchLegacy(params);
    return { ...legacy, degradedModes: [...degradedModes, ...legacy.degradedModes] };
  }

  const q = params.query.trim();
  const expandedQ = parsed.expandedSearchText?.trim() || q;
  const filterParts: Parameters<typeof buildFilterBy>[0] = {
    legalAidOnly: params.legalAidOnly,
    verifiedOnly: params.verifiedOnly,
    city: params.city,
    source: params.source,
    practiceArea: vagueQueryMode ? undefined : params.practiceArea,
  };

  let geoSortLat: number | undefined;
  let geoSortLng: number | undefined;
  const extraFilters: string[] = [];

  if (params.mapBounds) {
    const c = {
      lat: (params.mapBounds.north + params.mapBounds.south) / 2,
      lng: (params.mapBounds.east + params.mapBounds.west) / 2,
    };
    geoSortLat = c.lat;
    geoSortLng = c.lng;
    const radiusKm = Math.min(
      80,
      distanceMiles(
        { lat: params.mapBounds.north, lng: params.mapBounds.east },
        { lat: c.lat, lng: c.lng },
      ) * 1.60934,
    );
    extraFilters.push(buildGeoFilter({ lat: c.lat, lng: c.lng, radiusKm }));
  }

  if (extraFilters.length) filterParts.extra = extraFilters.join(" && ");
  const filterBy = buildFilterBy(filterParts);

  const retrieval = await searchWithTaxonomyRescue({
    parsed,
    q,
    expandedQ,
    limit: 80,
    filterBy,
    geoSortLat,
    geoSortLng,
    locationQ: parsed.location ?? params.location ?? params.city,
    vagueQueryMode,
    rescuePlan,
  });
  degradedModes.push(...retrieval.degradedModes);

  const rankingStages: RankingStageSnapshot[] = [];
  const snapshotK = 20;
  const pushRankingStage = (stage: string, rs: SearchResult[]) => {
    if (params.includeRankingStages) {
      rankingStages.push(snapshotRankingStage(stage, rs, snapshotK));
    }
  };

  const typesenseScoresById = new Map<string, number>();
  for (const h of retrieval.hits) {
    const id = String(h.document.id ?? "");
    if (id && h.textMatch != null) typesenseScoresById.set(id, h.textMatch);
  }

  let results: SearchResult[] = retrieval.hits.map((h) =>
    legalEntityDocToSearchResult(h.document, parsed, h.textMatch),
  );
  results = enrichListingResultsFromIndex(results, parsed);

  const preRankIndexById = new Map<string, number>();
  results.forEach((r, i) => preRankIndexById.set(r.id, i + 1));
  pushRankingStage("typesense_enriched", results);

  const behaviouralSignals = await loadBehaviouralSignalsForEntities(
    results.map((r) => ({ id: r.id, source: r.source })),
    { practiceArea: parsed.practiceAreaSlug, city: parsed.location },
  );
  const rerankOpts = {
    origin: params.origin,
    behaviouralSignals,
    vagueQueryMode: vagueQueryMode || Boolean(rescuePlan && retrieval.fallbackTriggered),
    vagueRescuePlan: rescuePlan ?? undefined,
  };
  results = rerankSearchResults(results, parsed, rerankOpts);

  if (rescuePlan && (vagueQueryMode || retrieval.fallbackTriggered)) {
    const before = results.length;
    results = filterVagueRescueResults(results, rescuePlan);
    if (results.length === 0 && before > 0 && retrieval.fallbackTriggered) {
      degradedModes.push("vague_filter_relaxed");
      results = sortByFinalScore(
        rerankSearchResults(
          retrieval.hits.map((h) => legalEntityDocToSearchResult(h.document, parsed, h.textMatch)),
          parsed,
          rerankOpts,
        ),
      ).slice(0, 80);
    }
  }
  results = sortByFinalScore(results);
  pushRankingStage("after_rerank_and_sort", results);
  results = applyProviderCapabilityRanking(results, parsed, {
    urgentIntent: isUrgentSearchQuery(parsed.semanticQuery) || parsed.intent === "emergency",
  });
  results = sortByFinalScore(results);
  pushRankingStage("after_capability_rank", results);

  const fundingIntent = parsed.fundingIntent ?? detectFundingIntent(parsed.semanticQuery);
  if (!parsed.fundingIntent) {
    parsed = { ...parsed, fundingIntent };
  }
  const diversityTopK = Math.min(10, params.limit ?? 40);
  const diversityPass = applySourceDiversity(results, fundingIntent, { topK: diversityTopK });
  results = diversityPass.results;
  let sourceDiversityDebug: SourceDiversityDebug = diversityPass.debug;
  pushRankingStage("after_source_diversity", results);

  if (rescuePlan && countUsefulVagueResults(results, rescuePlan) < 3) {
    const relaxedFilter = buildFilterBy({
      legalAidOnly: params.legalAidOnly,
      verifiedOnly: false,
      city: params.city,
    });
    const fallback = await searchWithTaxonomyRescue({
      parsed,
      q: rescuePlan.zeroResultFallbackQuery,
      expandedQ: rescuePlan.zeroResultFallbackQuery,
      limit: 80,
      filterBy: relaxedFilter,
      geoSortLat,
      geoSortLng,
      locationQ: parsed.location ?? params.location ?? params.city,
      vagueQueryMode: true,
      rescuePlan,
    });
    degradedModes.push("vague_rescue_fallback");
    if (fallback.hits.length) {
      const mergedIds = new Set(results.map((r) => r.id));
      const extra = fallback.hits
        .filter((h) => !mergedIds.has(String(h.document.id ?? "")))
        .map((h) => legalEntityDocToSearchResult(h.document, parsed, h.textMatch));
      results = [...results, ...enrichListingResultsFromIndex(extra, parsed)];
      results = rerankSearchResults(results, parsed, rerankOpts);
      if (rescuePlan) {
        const relaxed = filterVagueRescueResults(results, rescuePlan);
        results = relaxed.length > 0 ? relaxed : results;
      }
      results = sortByFinalScore(results);
      const rediv = applySourceDiversity(results, fundingIntent, { topK: diversityTopK });
      results = rediv.results;
      sourceDiversityDebug = rediv.debug;
    }
  }

  pushRankingStage("before_result_filters", results);

  results = filterByParams(results, params, { vagueQueryMode });
  const off = params.offset ?? 0;
  const lim = params.limit ?? 40;
  results = results.slice(off, off + lim);
  results = attachExplanations(results, parsed, rescuePlan ?? undefined);

  const vagueRescueNotice =
    rescuePlan && results.length > 0
      ? buildTaxonomyFallbackNotice(rescuePlan) ?? undefined
      : undefined;

  const taxonomyProjectionMatches = countProjectionMatches(results);

  const catalog = await collectIndexBalanceReport();
  const coverage = assessPrivateCoverage({
    query: params.query,
    parsed,
    results,
    catalog,
  });
  const coverageNotice = buildCoverageNotice(coverage);

  let externalFallback: DirectorySearchResponse["externalFallback"];
  if (coverage.triggerPrivateExternalFallback) {
    const fundingPref = detectFundingPreference(params.query);
    const fundingRoutes = resolveFundingRouteOrder(
      fundingPref === "private" || fundingPref === "fixed_fee" ? "private" : "unsure",
    );
    const fb = await runExternalFallback({
      internalResults: results,
      sections: groupResultsByFundingRoute(results, fundingRoutes, 10),
      fundingRoutes,
      fundingPreference: fundingPref,
      mergedQuery: params.query,
      parsed,
      sraAvailable: !degradedModes.some((m) => /sra/i.test(m)),
      catalog,
    });
    if (fb.triggered) {
      externalFallback = { ...fb, notice: PRIVATE_DIRECTORY_FALLBACK_NOTICE };
    }
  }

  return finalizeDirectoryDiagnostics(
    {
      results,
      legacyRows: toLegacyGetResponse(results),
      degradedModes,
      parsedQuery: parsed,
      latencyMs: Date.now() - t0,
      vagueRescueNotice,
      coverageNotice,
      externalFallback,
    },
    params.query,
    {
      typesenseQueries: retrieval.typesenseQueries,
      typesenseScoresById,
      preRankIndexById,
      searchedFields: retrieval.searchedFields,
      fallbackTriggered: retrieval.fallbackTriggered,
      taxonomyProjectionMatches,
      initialTypesenseHitCount: retrieval.initialHitCount,
      activeSearchEngine: "typesense_unified",
      sourceDiversity: sourceDiversityDebug,
      includeDebug: params.forceSearchDebug === true,
      rankingStages: rankingStages.length ? rankingStages : undefined,
    },
  );
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
      const raw = r.raw as { practiceAreaSlugs?: string[] } | null;
      if (raw?.practiceAreaSlugs?.includes(slug)) return true;
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
  if (p.verifiedOnly) out = out.filter((r) => r.verified === true);
  return out;
}
