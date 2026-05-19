import type { SearchResult } from "@/lib/legal-search/types";
import type { AnyMatch } from "@/lib/agent/types";
import { SEARCH_EVAL_CASES } from "@/lib/search-eval/cases";
import {
  explanationPassesSafety,
  gradeRelevance,
  mrr,
  ndcgLiteAtK,
  precisionAtK,
  recallAtK,
  taxonomyMatchesExpected,
} from "@/lib/search-eval/metrics";
import type {
  EvalRetrievedHit,
  SearchEvalAggregateMetrics,
  SearchEvalCase,
  SearchEvalCaseResult,
  SearchEvalReport,
} from "@/lib/search-eval/types";
import { getSearchStackStatus } from "@/lib/legal-search/search-startup";
import { isPrivateFacingSearchHit } from "@/lib/legal-search/source-diversity";
import { legalAidMislabeledAsPrivate } from "@/lib/legal-search/private-coverage";

const PASS_TAXONOMY_MIN = 0.85;
const PASS_NO_RESULT_MAX = 0.05;
const PASS_EXPLANATION_MIN = 1;

function buildHaystack(
  r: {
    title: string;
    description?: string;
    practiceAreas: string[];
    categories: string[];
  },
  raw?: Record<string, unknown> | null,
): string {
  const slugs = Array.isArray(raw?.practiceAreaSlugs)
    ? (raw!.practiceAreaSlugs as string[]).join(" ")
    : "";
  return [r.title, r.description ?? "", ...r.practiceAreas, ...r.categories, slugs]
    .join(" ")
    .toLowerCase();
}

function searchResultToHit(
  r: SearchResult,
  rank: number,
  testCase: SearchEvalCase,
): EvalRetrievedHit {
  const raw = r.raw as Record<string, unknown> | null;
  const haystack = buildHaystack(r, raw);
  const base = {
    id: r.id,
    title: r.title,
    source: r.source,
    entityType: String(raw?.entityType ?? r.source),
    practiceAreas: r.practiceAreas,
    categories: r.categories,
    haystack,
    explanation: r.explanation,
    scoreBreakdown: r.debug?.scoreBreakdown ?? r.scores,
    retrievalSources: r.debug?.retrievalSources,
  };
  const { relevant, reasons } = gradeRelevance(base, testCase);
  return { rank, ...base, relevant, relevanceReasons: reasons };
}

function matchToHit(match: AnyMatch, rank: number, testCase: SearchEvalCase): EvalRetrievedHit {
  const practiceAreas =
    match.kind === "lawyer"
      ? match.practiceAreas.map((p) => p.name)
      : ["SRA organisation"];
  const title = match.kind === "lawyer" ? match.name : match.businessName;
  const haystack = buildHaystack({
    title,
    practiceAreas,
    categories: match.kind === "lawyer" ? [match.city] : [match.city, match.postcode],
  });
  const source = match.kind === "lawyer" ? "lawyer" : "sra";
  const base = {
    id: match.id,
    title,
    source,
    entityType: match.kind,
    practiceAreas,
    categories: [],
    haystack,
    explanation: match.explanation,
    scoreBreakdown: match.scoreBreakdown as unknown as Record<string, number>,
    retrievalSources: match.debug?.retrievalSources,
  };
  const { relevant, reasons } = gradeRelevance(base, testCase);
  return { rank, ...base, relevant, relevanceReasons: reasons };
}

function evaluateCaseOutcome(
  testCase: SearchEvalCase,
  hits: EvalRetrievedHit[],
  opts: {
    parsedSlug?: string | null;
    clarified: boolean;
    resultCount: number;
    hasRefinementPrompt: boolean;
    mapMarkerRate: number;
    degradedModes: string[];
    fallbackTriggered: boolean;
    latencyMs: number;
    parsedQuery?: SearchEvalCaseResult["parsedQuery"];
    searchDebug?: SearchEvalCaseResult["searchDebug"];
    coverageNotice?: string;
    externalFallbackTriggered?: boolean;
    externalHasLawSocietyOrSra?: boolean;
    rawResults?: SearchResult[];
  },
): SearchEvalCaseResult {
  const k = testCase.topK;
  const top = hits.slice(0, k);
  const relevantInTopK = top.filter((h) => h.relevant).length;
  const taxonomyAccurate = taxonomyMatchesExpected(opts.parsedSlug, testCase);
  const clarificationAccurate = testCase.shouldClarify === opts.clarified;

  const explanationSafetyPass =
    hits.length === 0 ||
    hits.every((h) => explanationPassesSafety(h.explanation));

  const failures: string[] = [];

  if (testCase.expectedTaxonomySlug && !taxonomyAccurate) {
    failures.push(
      `taxonomy: expected ${testCase.expectedTaxonomySlug}, got ${opts.parsedSlug ?? "null"}`,
    );
  }
  if (!clarificationAccurate) {
    failures.push(
      `clarification: expected shouldClarify=${testCase.shouldClarify}, clarified=${opts.clarified}`,
    );
  }
  if (testCase.mustReturnResults && opts.resultCount === 0) {
    failures.push("no results returned (mustReturnResults)");
  }
  if (testCase.minRelevantInTopK > 0 && relevantInTopK < testCase.minRelevantInTopK) {
    failures.push(
      `recall: ${relevantInTopK}/${testCase.minRelevantInTopK} relevant in top ${k}`,
    );
  }
  if (!explanationSafetyPass) {
    failures.push("explanation safety failed on one or more hits");
  }
  if (testCase.expectedFundingIntent) {
    const got = opts.parsedQuery?.fundingIntent;
    if (got !== testCase.expectedFundingIntent) {
      failures.push(
        `fundingIntent: expected ${testCase.expectedFundingIntent}, got ${got ?? "null"}`,
      );
    }
  }
  if (testCase.maxLegalAidInTopK != null && top.length > 0) {
    const poolHasPrivateFacing = hits.some((h) => isPrivateFacingSearchHit(h));
    if (poolHasPrivateFacing) {
      const laCount = top.filter((h) => h.source === "legal_aid").length;
      if (laCount > testCase.maxLegalAidInTopK) {
        failures.push(
          `source diversity: ${laCount} legal_aid in top ${k} (max ${testCase.maxLegalAidInTopK})`,
        );
      }
    }
  }
  if (testCase.requirePrivateFacingInTopK && top.length > 0) {
    const hasPrivate = top.some((h) => isPrivateFacingSearchHit(h));
    if (!hasPrivate) {
      failures.push(
        `source diversity: no private/SRA/curated result in top ${k} (index may lack private family entities)`,
      );
    }
  }
  if (
    testCase.channel === "directory" &&
    testCase.mustReturnResults &&
    testCase.minRelevantInTopK === 0 &&
    (testCase.notes?.includes("Broad") || testCase.query.includes("help"))
  ) {
    if (opts.resultCount === 0) {
      failures.push("broad query returned empty (expected results + optional refinement)");
    }
  }

  if (testCase.expectCoverageNotice && !opts.coverageNotice?.trim()) {
    failures.push("expected coverage notice for limited private/family index");
  }
  if (testCase.expectExternalPrivateSignpost) {
    if (!opts.externalFallbackTriggered) {
      failures.push("expected external Law Society/SRA signpost section");
    } else if (!opts.externalHasLawSocietyOrSra) {
      failures.push("external fallback missing law_society or sra_register source");
    }
  }
  if (testCase.minSraInTopK != null && testCase.minSraInTopK > 0) {
    const sraCount = top.filter(
      (h) => h.source === "sra" || (h.entityType ?? "").includes("sra"),
    ).length;
    if (sraCount < testCase.minSraInTopK) {
      failures.push(`SRA results: ${sraCount} in top ${k} (min ${testCase.minSraInTopK})`);
    }
  }
  if (testCase.forbidLegalAidMislabeledAsPrivate && opts.rawResults) {
    for (const r of opts.rawResults.slice(0, k)) {
      if (legalAidMislabeledAsPrivate(r)) {
        failures.push(`legal aid result mislabeled as private: ${r.title}`);
      }
    }
  }

  const passed = failures.length === 0;

  return {
    caseId: testCase.id,
    query: testCase.query,
    channel: testCase.channel,
    passed,
    failures,
    parsedQuery: opts.parsedQuery,
    taxonomySlug: opts.parsedSlug,
    taxonomyAccurate,
    clarified: opts.clarified,
    clarificationAccurate,
    resultCount: opts.resultCount,
    relevantInTopK,
    precisionAtK: precisionAtK(top, k),
    recallAtK: recallAtK(top, k, testCase.minRelevantInTopK),
    mrr: mrr(top),
    ndcgAtK: ndcgLiteAtK(top, k),
    hasRefinementPrompt: opts.hasRefinementPrompt,
    mapMarkerRate: opts.mapMarkerRate,
    explanationSafetyPass: explanationSafetyPass,
    degradedModes: opts.degradedModes,
    fallbackTriggered: opts.fallbackTriggered,
    searchDebug: opts.searchDebug,
    hits: top,
    latencyMs: opts.latencyMs,
    notes: testCase.notes,
  };
}

async function runDirectoryCase(testCase: SearchEvalCase): Promise<SearchEvalCaseResult> {
  const { runDirectorySearch } = await import("@/lib/legal-search/run-directory-search");
  const t0 = Date.now();
  const dir = await runDirectorySearch({
    query: testCase.query,
    limit: testCase.topK,
    semantic: false,
  });
  const hits = dir.results.map((r, i) => searchResultToHit(r, i + 1, testCase));
  const parsedSlug = dir.parsedQuery.taxonomySlug ?? dir.parsedQuery.practiceAreaSlug ?? null;
  const hasRefinement = Boolean(
    dir.parsedQuery.refinementQuestion?.trim() || dir.parsedQuery.taxonomySummary?.trim(),
  );
  const withCoords = dir.results.filter(
    (r) => r.location?.lat != null && r.location?.lng != null,
  ).length;
  const mapMarkerRate = dir.results.length ? withCoords / dir.results.length : 0;

  const ext = dir.externalFallback;
  const externalHasLawSocietyOrSra = Boolean(
    ext?.results?.some((r) => r.source === "law_society" || r.source === "sra_register"),
  );

  return evaluateCaseOutcome(testCase, hits, {
    parsedSlug,
    clarified: false,
    resultCount: dir.results.length,
    hasRefinementPrompt: hasRefinement,
    mapMarkerRate,
    degradedModes: dir.degradedModes,
    fallbackTriggered: Boolean(dir.searchDebug?.fallbackTriggered || ext?.triggered),
    latencyMs: dir.latencyMs ?? Date.now() - t0,
    parsedQuery: dir.parsedQuery,
    searchDebug: dir.searchDebug,
    coverageNotice: dir.coverageNotice,
    externalFallbackTriggered: ext?.triggered,
    externalHasLawSocietyOrSra,
    rawResults: dir.results,
  });
}

async function runMatcherCase(testCase: SearchEvalCase): Promise<SearchEvalCaseResult> {
  const { runMatcherUnified } = await import("@/lib/legal-search/run-matcher-unified");
  const t0 = Date.now();
  const result = await runMatcherUnified({ query: testCase.query });
  const parsedSlug =
    result.parsedQuery.taxonomySlug ?? result.parsedQuery.practiceAreaSlug ?? null;

  if (result.kind === "clarify") {
    return evaluateCaseOutcome(testCase, [], {
      parsedSlug,
      clarified: true,
      resultCount: 0,
      hasRefinementPrompt: false,
      mapMarkerRate: 0,
      degradedModes: [],
      fallbackTriggered: Boolean(result.searchDebug?.fallbackTriggered),
      latencyMs: result.searchDebug?.latencyMs ?? Date.now() - t0,
      parsedQuery: result.parsedQuery,
      searchDebug: result.searchDebug,
    });
  }

  const hits = result.results.map((m, i) => matchToHit(m, i + 1, testCase));
  const withMarkers = result.results.filter((m) => m.mapMarker || m.location).length;
  const mapMarkerRate = result.results.length ? withMarkers / result.results.length : 0;
  const hasRefinement = Boolean(
    result.refinementQuestion?.trim() || result.taxonomySummary?.trim(),
  );

  return evaluateCaseOutcome(testCase, hits, {
    parsedSlug,
    clarified: false,
    resultCount: result.results.length,
    hasRefinementPrompt: hasRefinement,
    mapMarkerRate,
    degradedModes: result.searchDebug?.degradedModeWarnings ?? [],
    fallbackTriggered: Boolean(result.searchDebug?.fallbackTriggered),
    latencyMs: result.searchDebug?.latencyMs ?? Date.now() - t0,
    parsedQuery: result.parsedQuery,
    searchDebug: result.searchDebug,
  });
}

export function aggregateMetrics(results: SearchEvalCaseResult[]): SearchEvalAggregateMetrics {
  const n = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  const taxonomyAccurateCount = results.filter((r) => r.taxonomyAccurate).length;
  const taxonomyDenom = results.filter(
    (r) => SEARCH_EVAL_CASES.find((c) => c.id === r.caseId)?.expectedTaxonomySlug,
  ).length;

  const mustReturn = results.filter(
    (r) => SEARCH_EVAL_CASES.find((c) => c.id === r.caseId)?.mustReturnResults,
  );
  const noResultFailures = mustReturn.filter((r) => r.resultCount === 0).length;

  const matcherResults = results.filter((r) => r.channel === "matcher");
  const matcherClarifyOk = matcherResults.filter((r) => r.clarificationAccurate).length;

  const explanationPass = results.filter((r) => r.explanationSafetyPass).length;

  return {
    caseCount: n,
    passedCount,
    failedCount: n - passedCount,
    taxonomyAccuracy: taxonomyDenom ? taxonomyAccurateCount / taxonomyDenom : 1,
    clarificationAccuracy: matcherResults.length
      ? matcherClarifyOk / matcherResults.length
      : 1,
    noResultFailureRate: mustReturn.length ? noResultFailures / mustReturn.length : 0,
    avgPrecisionAtK: n ? results.reduce((s, r) => s + r.precisionAtK, 0) / n : 0,
    avgRecallAtK: n ? results.reduce((s, r) => s + r.recallAtK, 0) / n : 0,
    avgMrr: n ? results.reduce((s, r) => s + r.mrr, 0) / n : 0,
    avgNdcgAtK: n ? results.reduce((s, r) => s + r.ndcgAtK, 0) / n : 0,
    mapMarkerAvailabilityRate: n
      ? results.reduce((s, r) => s + r.mapMarkerRate, 0) / n
      : 0,
    explanationSafetyPassRate: n ? explanationPass / n : 1,
    passCriteriaMet:
      (taxonomyDenom ? taxonomyAccurateCount / taxonomyDenom : 1) >= PASS_TAXONOMY_MIN &&
      (mustReturn.length ? noResultFailures / mustReturn.length : 0) <= PASS_NO_RESULT_MAX &&
      (n ? explanationPass / n : 1) >= PASS_EXPLANATION_MIN,
  };
}

export type RunSearchEvalOptions = {
  cases?: SearchEvalCase[];
  skipMatcher?: boolean;
};

export async function runSearchEval(
  options: RunSearchEvalOptions = {},
): Promise<SearchEvalReport> {
  process.env.ENABLE_SEARCH_DEBUG = "true";
  const cases = options.cases ?? SEARCH_EVAL_CASES;
  const stack = await getSearchStackStatus();
  const results: SearchEvalCaseResult[] = [];

  for (const testCase of cases) {
    if (options.skipMatcher && testCase.channel === "matcher") {
      continue;
    }
    try {
      const result =
        testCase.channel === "directory"
          ? await runDirectoryCase(testCase)
          : await runMatcherCase(testCase);
      results.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        caseId: testCase.id,
        query: testCase.query,
        channel: testCase.channel,
        passed: false,
        failures: [`runner error: ${message}`],
        taxonomyAccurate: false,
        clarified: false,
        clarificationAccurate: false,
        resultCount: 0,
        relevantInTopK: 0,
        precisionAtK: 0,
        recallAtK: 0,
        mrr: 0,
        ndcgAtK: 0,
        hasRefinementPrompt: false,
        mapMarkerRate: 0,
        explanationSafetyPass: false,
        degradedModes: [],
        fallbackTriggered: false,
        hits: [],
        latencyMs: 0,
        notes: testCase.notes,
      });
    }
  }

  const aggregate = aggregateMetrics(results);

  return {
    generatedAt: new Date().toISOString(),
    stack: stack as unknown as Record<string, unknown>,
    aggregate,
    passCriteria: {
      taxonomyAccuracyMin: PASS_TAXONOMY_MIN,
      noResultFailureRateMax: PASS_NO_RESULT_MAX,
      explanationSafetyPassRateMin: PASS_EXPLANATION_MIN,
    },
    results,
  };
}
