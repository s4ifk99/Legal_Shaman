import "server-only";

import { parseQuery } from "@/lib/legal-search/query-understanding";
import type { ParsedQuery } from "@/lib/legal-search/types";
import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import { getSearchStackStatus } from "@/lib/legal-search/search-startup";
import { getCatalogStats } from "@/lib/search-index/catalog-stats";
import {
  applyTriageAnswer,
  createInitialTriageState,
  skipTriageStep,
} from "@/lib/legal-search/triage/triage-state";
import { resolveFundingRoutes } from "@/lib/legal-search/triage/funding-router";
import { assessTriageConfidence } from "@/lib/legal-search/triage/triage-engine";
import {
  buildLowConfidenceEmergencyGuidance,
  buildUrgentSignposting,
  triageCopyPassesSafety,
} from "@/lib/legal-search/triage/urgency-router";
import {
  buildMapMarkersFromResults,
  flattenSections,
  groupResultsByFundingRoute,
} from "@/lib/legal-search/triage/result-router";
import {
  assessTriageCompleteness,
  externalFallbackDecisionLabel,
  fundingRouteDecisionLabel,
  urgencyDecisionLabel,
} from "@/lib/legal-search/triage/completeness";
import type { TriageQuestion, TriageResponse, TriageState } from "@/lib/legal-search/triage/types";
import type { TriageCompletenessReport } from "@/lib/legal-search/triage/completeness";
import type { SearchResponseDebug } from "@/lib/legal-search/search-diagnostics-types";
import { TRIAGE_DISCLAIMER } from "@/lib/legal-search/triage/types";
import { runExternalFallback } from "@/lib/legal-search/external-fallback/web-search-client";
import type { TriageResultSection } from "@/lib/legal-search/triage/types";
import { enableSearchDebug } from "@/lib/legal-search/config";

export type TriageRequest =
  | { action: "start"; query: string; sessionId: string }
  | {
      action: "answer";
      sessionId: string;
      state: TriageState;
      field: TriageQuestion["field"];
      value: string;
    }
  | { action: "skip"; sessionId: string; state: TriageState; field: TriageQuestion["field"] };

export async function runTriageSearch(req: TriageRequest): Promise<TriageResponse> {
  let state: TriageState;

  if (req.action === "start") {
    state = createInitialTriageState(req.query, req.sessionId);
  } else if (req.action === "answer") {
    state = applyTriageAnswer(req.state, req.field, req.value);
  } else {
    state = skipTriageStep(req.state, req.field);
  }

  const parsed = await parseQuery(state.mergedQuery);
  const stack = await getSearchStackStatus();
  const catalog = await getCatalogStats();
  const degradedModes = [...stack.degradedModeWarnings];
  if ((catalog.sraTypesenseCount ?? 0) === 0) {
    degradedModes.push("SRA data unavailable");
  }

  const completeness = assessTriageCompleteness(state, parsed);
  const fundingRoutesPreview = resolveFundingRoutes(state);

  if (completeness.shouldAskBeforeSearch && completeness.nextBestQuestion) {
    const q = safeQuestion(completeness.nextBestQuestion);
    return questionResponse(state, q, parsed, completeness, fundingRoutesPreview);
  }

  if (completeness.canSearchNow) {
    const results = await executeTriageSearch(state, parsed, degradedModes);
    const updatedState: TriageState = {
      ...state,
      fundingRoutes: results.fundingRoutes,
      taxonomySlug: results.parsedQuery.taxonomySlug ?? state.taxonomySlug,
    };
    const afterCompleteness = assessTriageCompleteness(updatedState, results.parsedQuery, {
      afterResults: true,
    });
    const nextQ = afterCompleteness.nextBestQuestion
      ? safeQuestion(afterCompleteness.nextBestQuestion)
      : undefined;

    return resultsResponse(
      updatedState,
      results,
      results.parsedQuery,
      degradedModes,
      afterCompleteness,
      fundingRoutesPreview,
      nextQ,
    );
  }

  if (completeness.nextBestQuestion) {
    const q = safeQuestion(completeness.nextBestQuestion);
    return questionResponse(state, q, parsed, completeness, fundingRoutesPreview);
  }

  const results = await executeTriageSearch(state, parsed, degradedModes);
  const afterCompleteness = assessTriageCompleteness(state, results.parsedQuery, {
    afterResults: true,
  });
  return resultsResponse(
    state,
    results,
    results.parsedQuery,
    degradedModes,
    afterCompleteness,
    fundingRoutesPreview,
  );
}

function safeQuestion(q: TriageQuestion): TriageQuestion {
  if (triageCopyPassesSafety(q.prompt)) return q;
  return { ...q, prompt: "Can you tell us a bit more so we can signpost you?" };
}

function attachTriageDebug(
  base: SearchResponseDebug | undefined,
  opts: {
    completeness: TriageCompletenessReport;
    fundingRoutes: TriageState["fundingRoutes"];
    state: TriageState;
    externalFallback?: Awaited<ReturnType<typeof runExternalFallback>>;
  },
): SearchResponseDebug | undefined {
  if (!enableSearchDebug() && !base) return base;

  const patch: Partial<SearchResponseDebug> = {
    triageCompletenessScore: opts.completeness.completenessScore,
    triageMissingFields: opts.completeness.missingFields,
    triageNextBestQuestion: opts.completeness.nextBestQuestion?.field,
    fundingRouteDecision: fundingRouteDecisionLabel(
      opts.fundingRoutes.length ? opts.fundingRoutes : resolveFundingRoutes(opts.state),
      opts.state.fundingPreference,
    ),
    urgencyDecision: urgencyDecisionLabel(opts.state),
    externalFallbackDecision: externalFallbackDecisionLabel(
      Boolean(opts.externalFallback?.triggered),
      opts.externalFallback?.debug.fallbackReason,
    ),
  };

  if (opts.externalFallback?.triggered) {
    Object.assign(patch, {
      externalFallbackTriggered: true,
      externalFallbackReason: opts.externalFallback.debug.fallbackReason,
      externalFallbackSourcesQueried: opts.externalFallback.debug.fallbackSourcesQueried,
      externalResultsCount: opts.externalFallback.debug.externalResultsCount,
      externalFallbackVerificationWarnings: opts.externalFallback.debug.verificationWarnings,
      fallbackTriggered: true,
    });
  }

  if (!base) return undefined;
  return { ...base, ...patch };
}

function questionResponse(
  state: TriageState,
  question: TriageQuestion,
  parsed: ParsedQuery,
  completeness: TriageCompletenessReport,
  fundingRoutes: TriageState["fundingRoutes"],
  searchDebug?: SearchResponseDebug,
): TriageResponse {
  return {
    kind: "triage_question",
    triageState: state,
    question,
    parsedQuery: parsed,
    completeness,
    searchDebug: attachTriageDebug(searchDebug, {
      completeness,
      fundingRoutes,
      state,
    }),
    disclaimer: TRIAGE_DISCLAIMER,
  };
}

async function executeTriageSearch(
  state: TriageState,
  parsed: Awaited<ReturnType<typeof parseQuery>>,
  degradedModes: string[],
) {
  const fundingRoutes = resolveFundingRoutes(state);
  state = { ...state, fundingRoutes };

  const dir = await runDirectorySearch({
    query: state.mergedQuery,
    limit: 30,
    semantic: false,
    legalAidOnly: state.fundingPreference === "legal_aid",
  });

  if (degradedModes.includes("SRA data unavailable") || dir.degradedModes.length) {
    degradedModes.push(...dir.degradedModes);
  }

  const sections = groupResultsByFundingRoute(dir.results, fundingRoutes, 10);
  const flat = flattenSections(sections);
  const markers = buildMapMarkersFromResults(flat);

  const sraAvailable = !degradedModes.includes("SRA data unavailable");
  let externalFallback = dir.externalFallback;
  if (!externalFallback?.triggered) {
    externalFallback = await runExternalFallback({
      internalResults: dir.results,
      sections: sections as TriageResultSection[],
      fundingRoutes,
      fundingPreference: state.fundingPreference,
      mergedQuery: state.mergedQuery,
      parsed: dir.parsedQuery ?? parsed,
      sraAvailable,
    });
  }

  const searchDebug = attachTriageDebug(dir.searchDebug, {
    completeness: assessTriageCompleteness(state, dir.parsedQuery ?? parsed, {
      afterResults: true,
    }),
    fundingRoutes,
    state,
    externalFallback,
  });

  return {
    sections,
    fundingRoutes,
    parsedQuery: dir.parsedQuery ?? parsed,
    markers,
    searchDebug,
    externalFallback: externalFallback?.triggered ? externalFallback : undefined,
    coverageNotice: dir.coverageNotice,
    degradedModes: [...new Set(degradedModes)],
    urgentSignposting: resolveUrgentSignposting(state, parsed),
  };
}

function resolveUrgentSignposting(
  state: TriageState,
  parsed: ParsedQuery,
): ReturnType<typeof buildUrgentSignposting> {
  const urgent = buildUrgentSignposting(state.riskFlags, state.urgency);
  if (urgent) return urgent;
  const confidence = assessTriageConfidence(parsed, state.answers);
  if (confidence === "low") return buildLowConfidenceEmergencyGuidance();
  return undefined;
}

function resultsResponse(
  state: TriageState,
  results: Awaited<ReturnType<typeof executeTriageSearch>>,
  parsed: Awaited<ReturnType<typeof parseQuery>>,
  degradedModes: string[],
  completeness: TriageCompletenessReport,
  fundingRoutesPreview: TriageState["fundingRoutes"],
  nextQuestion?: TriageQuestion,
): TriageResponse {
  const updatedState: TriageState = {
    ...state,
    fundingRoutes: results.fundingRoutes,
    taxonomySlug: results.parsedQuery.taxonomySlug ?? state.taxonomySlug,
  };

  const finalCompleteness = assessTriageCompleteness(updatedState, results.parsedQuery, {
    afterResults: true,
  });

  return {
    kind: "triage_results",
    triageState: updatedState,
    fundingRoutes: results.fundingRoutes,
    sections: results.sections,
    urgentSignposting: results.urgentSignposting,
    nextQuestion: nextQuestion ?? finalCompleteness.nextBestQuestion,
    completeness: finalCompleteness,
    parsedQuery: results.parsedQuery,
    markers: results.markers,
    degradedModes: results.degradedModes,
    searchDebug:
      results.searchDebug ??
      attachTriageDebug(undefined, {
        completeness: finalCompleteness,
        fundingRoutes: results.fundingRoutes,
        state: updatedState,
        externalFallback: results.externalFallback,
      }),
    externalFallback: results.externalFallback,
    coverageNotice: results.coverageNotice,
    disclaimer: TRIAGE_DISCLAIMER,
  };
}
