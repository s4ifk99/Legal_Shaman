import type { ResultDebugDiagnostics, SearchResponseDebug } from "@/lib/legal-search/search-diagnostics-types";
import { MATCHER_RERANKER_VERSION } from "@/lib/legal-search/search-diagnostics-types";
import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import { mockLawyerMatchWithCoords } from "./matcher-map-cases";

const EMPLOYMENT_LONDON_QUERY = "employment advice in London";

export function mockResultDebug(): ResultDebugDiagnostics {
  return {
    retrievalSources: ["pgvector", "typesense"],
    originalRankBySource: { preRerank: 2, final: 1 },
    scoreBreakdown: {
      total: 0.82,
      practiceAreaMatch: 1,
      locationProximity: 0.9,
      semantic: 0.7,
    },
    matchedPracticeAreas: ["Employment"],
    matchedTaxonomyTerms: ["employment"],
    matchedLocationSignals: ["query city: London", "lawyer city: London"],
    matchedLanguageSignals: [],
    distanceMiles: 1.2,
    vectorDistance: 0.31,
    finalScore: 0.82,
    explanationInputs: ["Matches your search criteria."],
    warnings: [],
  };
}

export function mockSearchResponseDebug(): SearchResponseDebug {
  const parsedQuery = ruleBasedParse(EMPLOYMENT_LONDON_QUERY);
  return {
    queryPrefix: EMPLOYMENT_LONDON_QUERY,
    parsedQuery,
    expandedSearchText: "employment law unfair dismissal London",
    taxonomyMatch: { slug: "employment", label: "Employment", confidence: "high" },
    queryConfidence: "high",
    clarificationDecision: "none",
    filtersApplied: { city: "London" },
    degradedModeWarnings: [],
    resultCountsBySource: { pgvector: 1, typesense: 1 },
    rerankerVersion: MATCHER_RERANKER_VERSION,
    latencyMs: 42,
    channel: "matcher",
  };
}

export function mockMatcherPayloadWithDebug() {
  const match = { ...mockLawyerMatchWithCoords(), debug: mockResultDebug() };
  return {
    kind: "matches" as const,
    results: [match],
    markers: [match.mapMarker!],
    markerCount: 1,
    missingCoordinateCount: 0,
    disclaimer: "Not legal advice.",
    searchDebug: mockSearchResponseDebug(),
  };
}

export function mockClarifyPayloadWithDebug() {
  return {
    kind: "clarify" as const,
    question: "Which area of law?",
    disclaimer: "Not legal advice.",
    searchDebug: {
      ...mockSearchResponseDebug(),
      clarificationDecision: "asked" as const,
      resultCountsBySource: {},
    },
  };
}
