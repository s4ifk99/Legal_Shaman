import { enableSearchDebug } from "@/lib/legal-search/config";
import type { DirectorySearchResponse } from "@/lib/legal-search/types";
import type { ScoreBreakdown, ExtractedFilters, AnyMatch, AppliedFilters } from "@/lib/agent/types";
import type { RankedCandidate } from "@/lib/lawyers/rank";
import type { Candidate } from "@/lib/lawyers/search";
import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import {
  buildListingExplanation,
  buildSraExplanation,
} from "@/lib/legal-search/explanations";
import type {
  ClarificationDecision,
  ResultDebugDiagnostics,
  RetrievalSource,
  SearchResponseDebug,
} from "@/lib/legal-search/search-diagnostics-types";
import type { SourceDiversityDebug } from "@/lib/legal-search/source-diversity";
import {
  DIRECTORY_RERANKER_VERSION,
  MATCHER_RERANKER_VERSION,
} from "@/lib/legal-search/search-diagnostics-types";
import { rowMatchesPracticeTaxonomySlug } from "@/lib/legal/taxonomy";

export type {
  ClarificationDecision,
  ResultDebugDiagnostics,
  RetrievalSource,
  SearchResponseDebug,
} from "@/lib/legal-search/search-diagnostics-types";

export {
  DIRECTORY_RERANKER_VERSION,
  MATCHER_RERANKER_VERSION,
} from "@/lib/legal-search/search-diagnostics-types";

function queryPrefix(q: string, max = 80): string {
  const t = q.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function uniqueSources(sources: RetrievalSource[]): RetrievalSource[] {
  return [...new Set(sources)];
}

function matcherSourceToRetrieval(s: Candidate["sources"][number]): RetrievalSource {
  switch (s) {
    case "vector":
      return "pgvector";
    case "keyword":
      return "ilike";
    case "typesense":
      return "typesense";
    case "filter":
    default:
      return "legacy";
  }
}

function directorySourcesFromRaw(raw: unknown): RetrievalSource[] {
  const sources: RetrievalSource[] = [];
  if (!raw || typeof raw !== "object") return ["legacy"];

  const r = raw as Record<string, unknown>;

  if (r._retrievalSources && Array.isArray(r._retrievalSources)) {
    return uniqueSources(r._retrievalSources as RetrievalSource[]);
  }

  if (r.entityType != null || r.searchText != null) {
    sources.push("typesense");
  }

  const listingSources = (r as { sources?: string[] }).sources;
  if (Array.isArray(listingSources)) {
    if (listingSources.includes("semantic")) sources.push("pgvector");
    if (listingSources.includes("lexical")) sources.push("legacy");
  }

  if ((r as { sraId?: string }).sraId != null || (r as { businessName?: string }).businessName) {
    if (!sources.includes("typesense")) sources.push("meilisearch");
  }

  if (r.kind === "adl" || r.kind === "adlGroup") {
    const hit = r as { hit?: { sources?: string[] }; hits?: { sources?: string[] }[] };
    const srcs = hit.hit?.sources ?? hit.hits?.flatMap((h) => h.sources ?? []) ?? [];
    if (srcs.includes("semantic")) sources.push("pgvector");
    if (srcs.includes("lexical")) sources.push("legacy");
  }

  if (sources.length === 0) sources.push("legacy");
  return uniqueSources(sources);
}

function taxonomyTerms(parsed: ParsedQuery): string[] {
  const terms: string[] = [];
  if (parsed.taxonomyPrimaryLabel) terms.push(parsed.taxonomyPrimaryLabel);
  if (parsed.taxonomySlug) terms.push(parsed.taxonomySlug);
  for (const l of parsed.taxonomyRelatedLabels ?? []) terms.push(l);
  return terms.filter(Boolean);
}

function matchedPracticeAreas(result: SearchResult, parsed: ParsedQuery): string[] {
  const slug = parsed.practiceAreaSlug?.toLowerCase();
  if (!slug) return result.practiceAreas.slice(0, 6);
  return result.practiceAreas.filter((p) => {
    const hay = `${result.title} ${result.description ?? ""} ${p}`;
    return rowMatchesPracticeTaxonomySlug(slug, hay) || p.toLowerCase().includes(slug.replace(/_/g, " "));
  });
}

function locationSignals(result: SearchResult, parsed: ParsedQuery): string[] {
  const out: string[] = [];
  if (parsed.location) out.push(`query city: ${parsed.location}`);
  if (parsed.postcode) out.push(`query postcode: ${parsed.postcode}`);
  if (result.location?.city) out.push(`result city: ${result.location.city}`);
  if (result.location?.postcode) out.push(`result postcode: ${result.location.postcode}`);
  if (result.location?.lat != null && result.location?.lng != null) {
    out.push(`coordinates: ${result.location.lat.toFixed(4)}, ${result.location.lng.toFixed(4)}`);
  }
  return out;
}

function languageSignals(result: SearchResult, parsed: ParsedQuery): string[] {
  const want = parsed.languagePreference ?? [];
  if (!want.length) return [];
  const have = result.languages ?? [];
  return want.filter((w) => have.some((h) => h.toLowerCase().includes(w.toLowerCase())));
}

function explanationInputsForDirectory(result: SearchResult, parsed: ParsedQuery): string[] {
  if (result.source === "sra") {
    return [buildSraExplanation(result)];
  }
  const src = (result.raw as { sources?: string[] })?.sources ?? [];
  return [buildListingExplanation(result, parsed, src)];
}

export function buildDirectoryResultDebug(
  result: SearchResult,
  parsed: ParsedQuery,
  ctx?: {
    finalRank?: number;
    originalRankBySource?: Record<string, number>;
    extraSources?: RetrievalSource[];
    typesenseScore?: number;
  },
): ResultDebugDiagnostics {
  const raw = result.raw as Record<string, unknown> | null;
  const retrievalSources = uniqueSources([
    ...directorySourcesFromRaw(raw),
    ...(ctx?.extraSources ?? []),
    ...(parsed.expandedSearchText && parsed.expandedSearchText !== parsed.semanticQuery
      ? (["taxonomy"] as RetrievalSource[])
      : []),
  ]);

  const typesenseScore =
    ctx?.typesenseScore ??
    (typeof raw?.text_match === "number"
      ? raw.text_match
      : typeof raw?.textMatch === "number"
        ? raw.textMatch
        : undefined);

  const capDebug = raw?._capabilityDebug as
    | {
        capabilityMatches?: string[];
        contactDataSource?: string;
        contactConfidence?: number;
        missingContactFields?: string[];
        enrichmentStatus?: string;
      }
    | undefined;

  return {
    retrievalSources,
    originalRankBySource: ctx?.originalRankBySource,
    scoreBreakdown: { ...result.scores },
    matchedPracticeAreas: matchedPracticeAreas(result, parsed),
    matchedTaxonomyTerms: taxonomyTerms(parsed),
    matchedLocationSignals: locationSignals(result, parsed),
    matchedLanguageSignals: languageSignals(result, parsed),
    distanceMiles: undefined,
    vectorDistance: undefined,
    keywordScore: result.scores.keyword,
    typesenseScore,
    finalScore: result.scores.final,
    explanationInputs: explanationInputsForDirectory(result, parsed),
    warnings: result.warnings ?? [],
    capabilityMatches: capDebug?.capabilityMatches,
    contactDataSource: capDebug?.contactDataSource ?? (raw?.contactSource as string | undefined),
    contactConfidence: capDebug?.contactConfidence ?? (raw?.contactConfidence as number | undefined),
    missingContactFields: capDebug?.missingContactFields,
    enrichmentStatus: capDebug?.enrichmentStatus ?? (raw?.enrichmentStatus as string | undefined),
  };
}

export function buildMatcherResultDebug(
  match: AnyMatch,
  ranked: RankedCandidate,
  parsed: ParsedQuery,
  extracted: ExtractedFilters,
  ctx?: { finalRank?: number },
): ResultDebugDiagnostics {
  const retrievalSources = uniqueSources(ranked.sources.map(matcherSourceToRetrieval));
  if (
    parsed.expandedSearchText &&
    parsed.expandedSearchText !== (extracted.semanticQuery || parsed.semanticQuery)
  ) {
    retrievalSources.push("taxonomy");
  }

  const scoreBreakdown: Record<string, number> = { ...match.scoreBreakdown };
  const locationSignalsList: string[] = [];
  if (extracted.city) locationSignalsList.push(`query city: ${extracted.city}`);
  if (extracted.postcode) locationSignalsList.push(`query postcode: ${extracted.postcode}`);
  if (match.kind === "lawyer") {
    locationSignalsList.push(`lawyer city: ${match.city}`);
    if (match.location?.distanceMiles != null) {
      locationSignalsList.push(`distance: ${match.location.distanceMiles} mi`);
    }
  } else {
    locationSignalsList.push(`${match.city} ${match.postcode}`.trim());
    if (match.location?.distanceMiles != null) {
      locationSignalsList.push(`distance: ${match.location.distanceMiles} mi`);
    }
  }

  const practiceAreas =
    match.kind === "lawyer"
      ? match.practiceAreas.map((p) => p.name)
      : extracted.practiceArea
        ? [extracted.practiceArea]
        : [];

  return {
    retrievalSources: uniqueSources(retrievalSources),
    originalRankBySource: ctx?.finalRank != null ? { final: ctx.finalRank } : undefined,
    scoreBreakdown,
    matchedPracticeAreas: practiceAreas,
    matchedTaxonomyTerms: taxonomyTerms(parsed),
    matchedLocationSignals: locationSignalsList,
    matchedLanguageSignals:
      match.kind === "lawyer" && extracted.languages?.length
        ? match.languages.filter((l) =>
            extracted.languages!.some((w) => l.toLowerCase().includes(w.toLowerCase())),
          )
        : [],
    distanceMiles: match.location?.distanceMiles,
    vectorDistance: ranked.cosineDistance ?? undefined,
    keywordScore: undefined,
    typesenseScore: undefined,
    finalScore: match.scoreBreakdown.total,
    explanationInputs: [match.explanation],
    warnings: [],
  };
}

function countByRetrievalSource(results: { debug?: ResultDebugDiagnostics }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    for (const s of r.debug?.retrievalSources ?? []) {
      counts[s] = (counts[s] ?? 0) + 1;
    }
  }
  return counts;
}

function aggregateRetrievalSources(results: { debug?: ResultDebugDiagnostics }[]): string[] {
  const set = new Set<string>();
  for (const r of results) {
    for (const s of r.debug?.retrievalSources ?? []) set.add(s);
  }
  return [...set];
}

export function buildSearchResponseDebug(args: {
  channel: "directory" | "matcher";
  query: string;
  parsedQuery: ParsedQuery;
  degradedModes: string[];
  latencyMs: number;
  rerankerVersion: string;
  results: { debug?: ResultDebugDiagnostics }[];
  extracted?: ExtractedFilters;
  appliedFilters?: AppliedFilters;
  typesenseQueries?: unknown;
  searchedFields?: string[];
  fallbackTriggered?: boolean;
  taxonomyProjectionMatches?: string[];
  initialTypesenseHitCount?: number;
  finalHitCount?: number;
  activeSearchEngine?: "typesense_unified" | "legacy";
  clarificationDecision?: ClarificationDecision;
  sourceDiversity?: SourceDiversityDebug;
  rankingStages?: import("@/lib/legal-search/search-diagnostics-types").RankingStageSnapshot[];
}): SearchResponseDebug {
  const sd = args.sourceDiversity;
  return {
    queryPrefix: queryPrefix(args.query),
    parsedQuery: args.parsedQuery,
    expandedSearchText: args.parsedQuery.expandedSearchText,
    taxonomyMatch: {
      slug: args.parsedQuery.taxonomySlug ?? args.parsedQuery.practiceAreaSlug ?? undefined,
      label: args.parsedQuery.taxonomyPrimaryLabel,
      confidence: args.parsedQuery.queryConfidence,
    },
    queryConfidence: args.parsedQuery.queryConfidence,
    clarificationDecision: args.clarificationDecision ?? "none",
    filtersApplied: {
      ...(args.extracted
        ? {
            practiceArea: args.extracted.practiceArea,
            city: args.extracted.city,
            postcode: args.extracted.postcode,
            jurisdiction: args.extracted.jurisdiction,
            languages: args.extracted.languages,
          }
        : {}),
      ...(args.appliedFilters ?? {}),
    },
    typesenseQueries: args.typesenseQueries,
    searchedFields: args.searchedFields,
    fallbackTriggered: args.fallbackTriggered,
    taxonomyProjectionMatches: args.taxonomyProjectionMatches,
    initialTypesenseHitCount: args.initialTypesenseHitCount,
    finalHitCount: args.finalHitCount,
    retrievalSources: aggregateRetrievalSources(args.results),
    activeSearchEngine: args.activeSearchEngine,
    degradedModeWarnings: args.degradedModes,
    resultCountsBySource: countByRetrievalSource(args.results),
    rerankerVersion: args.rerankerVersion,
    latencyMs: args.latencyMs,
    channel: args.channel,
    fundingIntent: sd?.fundingIntent ?? args.parsedQuery.fundingIntent,
    sourceDiversityApplied: sd?.sourceDiversityApplied,
    sourceCaps: sd?.sourceCaps,
    preDiversificationSourceCounts: sd?.preDiversificationSourceCounts,
    postDiversificationSourceCounts: sd?.postDiversificationSourceCounts,
    legalAidBoostApplied: sd?.legalAidBoostApplied,
    legalAidBoostReason: sd?.legalAidBoostReason,
    rankingStages: args.rankingStages,
  };
}

export function attachDirectoryDebug(
  results: SearchResult[],
  parsed: ParsedQuery,
  ctx?: {
    typesenseQueries?: unknown;
    preRankIndexById?: Map<string, number>;
    typesenseScoresById?: Map<string, number>;
  },
): SearchResult[] {
  return results.map((r, i) => ({
    ...r,
    debug: buildDirectoryResultDebug(r, parsed, {
      finalRank: i + 1,
      originalRankBySource: ctx?.preRankIndexById?.has(r.id)
        ? { preRerank: ctx.preRankIndexById.get(r.id)! }
        : undefined,
      typesenseScore: ctx?.typesenseScoresById?.get(r.id),
      extraSources:
        parsed.expandedSearchText && parsed.expandedSearchText.length > parsed.semanticQuery.length
          ? ["taxonomy"]
          : undefined,
    }),
  }));
}

export function attachMatcherDebug(
  matches: AnyMatch[],
  ranked: RankedCandidate[],
  parsed: ParsedQuery,
  extracted: ExtractedFilters,
): AnyMatch[] {
  return matches.map((m, i) => {
    const r = ranked[i];
    if (!r) return m;
    const debug = buildMatcherResultDebug(m, r, parsed, extracted, { finalRank: i + 1 });
    return { ...m, debug };
  });
}

/** Strip debug from API payloads when diagnostics are disabled. */
export function stripSearchDebug<T extends Record<string, unknown>>(payload: T): T {
  const out = { ...payload } as Record<string, unknown>;
  delete out.searchDebug;
  delete out.parsedQuery;
  delete out.degradedModes;
  delete out.latencyMs;
  delete out.unifiedResults;

  if (Array.isArray(out.results)) {
    out.results = (out.results as Record<string, unknown>[]).map((r) => {
      const row = { ...r };
      delete row.debug;
      return row;
    });
  }

  return out as T;
}

export { stripSearchDebugPayload } from "@/lib/legal-search/search-diagnostics-types";

export function scoreBreakdownFromMatcher(sb: ScoreBreakdown): Record<string, number> {
  return { ...sb };
}

export function finalizeDirectoryDiagnostics(
  resp: DirectorySearchResponse,
  query: string,
  ctx?: {
    typesenseQueries?: unknown;
    preRankIndexById?: Map<string, number>;
    typesenseScoresById?: Map<string, number>;
    searchedFields?: string[];
    fallbackTriggered?: boolean;
    taxonomyProjectionMatches?: string[];
    initialTypesenseHitCount?: number;
    activeSearchEngine?: "typesense_unified" | "legacy";
    sourceDiversity?: SourceDiversityDebug;
    /** When true, attach debug even if ENABLE_SEARCH_DEBUG is false (admin tooling). */
    includeDebug?: boolean;
    rankingStages?: import("@/lib/legal-search/search-diagnostics-types").RankingStageSnapshot[];
  },
): DirectorySearchResponse {
  const showDebug = ctx?.includeDebug === true || enableSearchDebug();
  if (!showDebug) return resp;

  const results = attachDirectoryDebug(resp.results, resp.parsedQuery, {
    typesenseQueries: ctx?.typesenseQueries,
    preRankIndexById: ctx?.preRankIndexById,
    typesenseScoresById: ctx?.typesenseScoresById,
  });

  const searchDebug = buildSearchResponseDebug({
    channel: "directory",
    query,
    parsedQuery: resp.parsedQuery,
    degradedModes: resp.degradedModes,
    latencyMs: resp.latencyMs,
    rerankerVersion: DIRECTORY_RERANKER_VERSION,
    results,
    typesenseQueries: ctx?.typesenseQueries,
    searchedFields: ctx?.searchedFields,
    fallbackTriggered: ctx?.fallbackTriggered,
    taxonomyProjectionMatches: ctx?.taxonomyProjectionMatches,
    initialTypesenseHitCount: ctx?.initialTypesenseHitCount,
    finalHitCount: results.length,
    activeSearchEngine: ctx?.activeSearchEngine,
    clarificationDecision: "none",
    sourceDiversity: ctx?.sourceDiversity,
    rankingStages: ctx?.rankingStages,
  });

  return { ...resp, results, searchDebug };
}
