import "server-only";

import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import {
  assembleFromKnowledgeGraph,
  graphAssemblySourcesWithCitations,
} from "@/lib/knowledge-compiler/assemble-answer";
import { isConsumerIntent } from "@/lib/knowledge-compiler/page-index";

import {
  suggestedNextStepsForClassification,
} from "./classify";
import { decomposeLegalSearchQuery } from "./decompose-query";
import { scoreRetrievalConfidence } from "./confidence";
import { rankChunksForAnswer } from "./clean-prose";
import { generateCitationFirstAnswer } from "./generate-answer";
import { hybridLegalRetrieval } from "./retrieval";
import { rerankLegalChunks } from "./rerank";
import { buildLegalSearchContext } from "./search-context";
import {
  deriveLegalSearchIntent,
  directoryPracticeAreaForIntent,
  directorySearchQueryForIntent,
  filterDirectoryResultsByIntent,
  refineIntentFromChunks,
} from "./search-intent";
import type { LegalSearchRequest, LegalSearchResponse } from "./types";
import { LEGAL_SEARCH_DISCLAIMER } from "./types";
import { retrieveWikiAsChunks } from "./wiki-retrieval";
import { tryWikiPrimaryAnswer, wikiPrimaryToResponse } from "./wiki-primary-answer";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { toLegacyGetResponse } from "@/lib/legal-search/legacy-get-response";
import { processSearchQuery } from "@/lib/legal-search/query-limits";
import { planSearchRoutes, routeCap } from "./route-planner";
import { retrieveSearchRoutes } from "./route-retrieve";
import { applyLlmRouteAdvice, arbitrateSearchRoutes } from "./route-arbiter";
import { adviseRoutesWithLlm } from "./route-llm-advisor";
import { satnavLlmEachStageEnabled } from "./route-llm-config";
import { applyLlmRoutePlan, planRoutesWithLlm } from "./route-llm-planner";
import { rerankRouteHitsWithLlm } from "./route-llm-rerank";
import { synthesizeFromRouteArbitration } from "./route-synthesize";
import {
  buildSatnavTrainingRecord,
  logSatnavTrainingRecord,
} from "./route-training-log";
import { searchRouteMode } from "./route-types";

type GraphMode = "primary" | "shadow" | "off";

const GRAPH_MIN_CONFIDENCE = 0.58;

function fusionDebug(context: Awaited<ReturnType<typeof buildLegalSearchContext>>) {
  return {
    fusionSource: context.fusion.fusionSource,
    ruleTaxonomySlug: context.fusion.ruleTaxonomySlug,
    llmTaxonomySlug: context.fusion.llmTaxonomySlug,
    ruleMatchStrength: context.fusion.ruleMatchStrength,
    llmConfidence: context.fusion.llmConfidence,
    phraseCandidates: context.fusion.phraseCandidates,
  };
}

function knowledgeGraphMode(): GraphMode {
  const raw = process.env.KNOWLEDGE_GRAPH_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "primary") return raw;
  return "primary";
}

type DirectorySlice = {
  directoryResults: LegalSearchResponse["directoryResults"];
  directoryRows: LegacyGetRow[];
};

const EMPTY_DIRECTORY: DirectorySlice = { directoryResults: [], directoryRows: [] };

async function runDirectorySlice(
  input: LegalSearchRequest,
  context: Awaited<ReturnType<typeof buildLegalSearchContext>>,
  intent: ReturnType<typeof deriveLegalSearchIntent>,
): Promise<DirectorySlice> {
  if (context.includeDirectory === false) return EMPTY_DIRECTORY;

  const directoryTimeoutMs = Number(process.env.LEGAL_DIRECTORY_TIMEOUT_MS ?? 0);

  const run = async (): Promise<DirectorySlice> => {
    const shortQ = directorySearchQueryForIntent(input.query, intent);
    const practiceArea = directoryPracticeAreaForIntent(intent, input.query);
    const directoryIntent = { ...intent, semanticQuery: shortQ };
    const directory = await runDirectorySearch({
      query: shortQ,
      limit: 8,
      semantic: false,
      location: input.location,
      practiceArea,
      parsed: context.parsedQuery,
      searchIntent: directoryIntent,
      legalAidOnly: context.resolution?.legalAidLikely || undefined,
      freeOnly: context.classification.urgency === "emergency" ? true : undefined,
    });

    const filtered = filterDirectoryResultsByIntent(directory.results, directoryIntent);
    const slice = filtered.slice(0, 6);
    const directoryRows = toLegacyGetResponse(slice).slice(0, 6) as LegacyGetRow[];
    const directoryResults = slice.map((r) => ({
      id: r.id,
      title: r.displayName ?? r.title,
      source: r.sourceLabel ?? r.source,
      url: r.contact?.website?.trim() || undefined,
      locationLabel: r.locationLabel,
      explanation: r.explanation,
      score: Number(r.scores.final.toFixed(4)),
    }));
    return { directoryResults, directoryRows };
  };

  try {
    if (directoryTimeoutMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return await Promise.race([
        run(),
        new Promise<DirectorySlice>((resolve) => {
          timer = setTimeout(() => resolve(EMPTY_DIRECTORY), directoryTimeoutMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    }
    return await run();
  } catch (err) {
    console.warn("[legal-knowledge.search] directory search failed:", err);
    return EMPTY_DIRECTORY;
  }
}

async function runSatnavSearch(
  input: LegalSearchRequest,
  context: Awaited<ReturnType<typeof buildLegalSearchContext>>,
  intent: ReturnType<typeof deriveLegalSearchIntent>,
  directoryPromise: Promise<DirectorySlice>,
): Promise<LegalSearchResponse> {
  const { query, includeDirectory, jurisdiction } = context;
  const graphMode = knowledgeGraphMode();

  const routes = planSearchRoutes({
    query,
    intent,
    fusion: context.fusion,
  });

  let plannedRoutes = routes;
  let llmPlanner = null as Awaited<ReturnType<typeof planRoutesWithLlm>>;
  if (satnavLlmEachStageEnabled()) {
    llmPlanner = await planRoutesWithLlm({ query, intent, baseRoutes: routes });
    plannedRoutes = applyLlmRoutePlan(routes, llmPlanner, routeCap());
  }

  // Optional cheap graph assemble — prefer only when wiki routes are weak.
  const [hitSetsRaw, graphResult] = await Promise.all([
    retrieveSearchRoutes({ routes: plannedRoutes, query, intent }),
    graphMode !== "off" && isConsumerIntent(intent)
      ? assembleFromKnowledgeGraph(context, intent).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (
    graphResult &&
    graphMode === "primary" &&
    graphResult.confidence >= GRAPH_MIN_CONFIDENCE
  ) {
    const bestWiki = Math.max(0, ...hitSetsRaw.map((h) => h.topScore));
    if (bestWiki < 8 && graphResult.confidence >= 0.7) {
      const directorySlice = await directoryPromise;
      const searchCriteria = decomposeLegalSearchQuery({
        query,
        location: input.location,
        jurisdiction,
        includeDirectory,
        context,
        intent,
        routesConsidered: routes.map((r) => ({
          id: r.id,
          label: r.label,
          query: r.query,
        })),
        chosenRouteIds: ["graph"],
        routeDecision: "pick",
      });
      return {
        answerType: "legal_information",
        confidence: Number(graphResult.confidence.toFixed(3)),
        issueClassification: {
          ...context.classification,
          subArea: intent.taxonomySlug ?? context.classification.subArea,
          specificIssue: intent.specificIssue ?? context.classification.specificIssue,
        },
        sources: graphResult.sources,
        directoryResults: directorySlice.directoryResults,
        directoryRows: directorySlice.directoryRows.length
          ? directorySlice.directoryRows
          : undefined,
        suggestedNextSteps: suggestedNextStepsForClassification(context.classification),
        clarifyingQuestion:
          graphResult.clarifyingQuestion ?? context.fusion.clarifyingQuestion ?? null,
        answer: graphAssemblySourcesWithCitations(graphResult.answer, graphResult.sources),
        answerMode: "graph_assembly",
        disclaimer: LEGAL_SEARCH_DISCLAIMER,
        searchCriteria,
        debug: {
          retrievalCount: graphResult.sources.length,
          rerankedCount: graphResult.sources.length,
          mode: "graph",
          intentSignals: intent.signals,
          conceptCluster: [
            graphResult.conceptCluster.primary.wikiPageId,
            ...graphResult.conceptCluster.related.map((r) => r.wikiPageId),
          ],
          classificationFusion: fusionDebug(context),
          searchRouteMode: "satnav",
          routeDecision: "pick",
          chosenRouteIds: ["graph"],
          routeRationale: `Graph assembly won (confidence ${graphResult.confidence.toFixed(2)}; wiki topScore ${bestWiki.toFixed(1)}).`,
          routesConsidered: routes.map((r) => ({
            id: r.id,
            label: r.label,
            query: r.query,
            taxonomySlug: r.taxonomySlug,
            score: 0,
          })),
        },
      };
    }
  }

  let hitSets = hitSetsRaw;
  let llmReranks: Awaited<ReturnType<typeof rerankRouteHitsWithLlm>>["reranks"] = [];
  if (satnavLlmEachStageEnabled()) {
    const reranked = await rerankRouteHitsWithLlm(query, hitSets);
    hitSets = reranked.hitSets;
    llmReranks = reranked.reranks;
  }

  const satnavT0 = Date.now();
  const ruleArbiter = arbitrateSearchRoutes({ query, hitSets });
  const llmAdvice = await adviseRoutesWithLlm(query, hitSets);
  const { arbitration, decidedBy } = applyLlmRouteAdvice({
    arbiter: ruleArbiter,
    hitSets,
    llmAdvice,
  });
  const directorySlice = await directoryPromise;

  const searchCriteria = decomposeLegalSearchQuery({
    query,
    location: input.location,
    jurisdiction,
    includeDirectory,
    context,
    intent,
    routesConsidered: ruleArbiter.routesConsidered.map((r) => ({
      id: r.id,
      label: r.label,
      query: r.query,
    })),
    chosenRouteIds: arbitration.chosenRouteIds,
    routeDecision: arbitration.decision,
  });

  const { response, wikiPayload } = await synthesizeFromRouteArbitration({
    query,
    arbitration,
    intent,
    context,
    directoryResults: directorySlice.directoryResults,
    directoryRows: directorySlice.directoryRows,
    suggestedNextSteps: suggestedNextStepsForClassification(context.classification),
    searchCriteria,
    forceLlm: satnavLlmEachStageEnabled(),
  });

  logSatnavTrainingRecord(
    buildSatnavTrainingRecord({
      query,
      hitSets,
      arbiter: ruleArbiter,
      llmAdvisor: llmAdvice,
      llmPlanner,
      llmReranks,
      finalDecision: {
        decision: arbitration.decision,
        chosenRouteIds: arbitration.chosenRouteIds,
        rationale: arbitration.rationale,
        decidedBy,
      },
      wikiPayload,
      sourceTitles: response.sources.map((s) => s.title),
      latencyMs: Date.now() - satnavT0,
    }),
  );

  return {
    ...response,
    debug: {
      ...response.debug,
      routeRationale: arbitration.rationale,
      satnavLlmEachStage: satnavLlmEachStageEnabled(),
      llmStages: satnavLlmEachStageEnabled()
        ? {
            planner: llmPlanner,
            rerank: llmReranks,
            advisor: llmAdvice,
            decidedBy,
            synthesis: wikiPayload?.synthesisMeta?.used ?? (response.answer ? "deterministic" : "none"),
          }
        : undefined,
      ...(llmAdvice
        ? {
            llmRouteAdvice: {
              chosenRouteIds: llmAdvice.chosenRouteIds,
              decision: llmAdvice.decision,
              confidence: llmAdvice.confidence,
              error: llmAdvice.error,
            },
          }
        : {}),
    },
  };
}

/** Legacy sequential cascade: wiki → graph → RAG. */
async function runLegacySearch(
  input: LegalSearchRequest,
  context: Awaited<ReturnType<typeof buildLegalSearchContext>>,
  initialIntent: ReturnType<typeof deriveLegalSearchIntent>,
  directoryPromise: Promise<DirectorySlice>,
): Promise<LegalSearchResponse> {
  const { query, includeDirectory, jurisdiction } = context;
  const graphMode = knowledgeGraphMode();

  const wikiPrimary = await tryWikiPrimaryAnswer(processSearchQuery(query));
  if (wikiPrimary) {
    const directorySlice = await directoryPromise;
    const searchCriteria = decomposeLegalSearchQuery({
      query,
      location: input.location,
      jurisdiction,
      includeDirectory,
      context,
      intent: initialIntent,
    });
    const response = wikiPrimaryToResponse({
      wiki: wikiPrimary,
      context,
      intent: initialIntent,
      directoryResults: directorySlice.directoryResults,
      directoryRows: directorySlice.directoryRows,
      suggestedNextSteps: suggestedNextStepsForClassification(context.classification),
      searchCriteria,
    });
    return {
      ...response,
      debug: { ...response.debug!, searchRouteMode: "legacy" },
    };
  }

  if (graphMode !== "off" && isConsumerIntent(initialIntent)) {
    const graphResult = await assembleFromKnowledgeGraph(context, initialIntent);

    if (
      graphResult &&
      graphMode === "primary" &&
      graphResult.confidence >= GRAPH_MIN_CONFIDENCE
    ) {
      const { directoryResults, directoryRows } = await directoryPromise;
      const searchCriteria = decomposeLegalSearchQuery({
        query,
        location: input.location,
        jurisdiction,
        includeDirectory,
        context,
        intent: initialIntent,
      });
      const answer = graphAssemblySourcesWithCitations(
        graphResult.answer,
        graphResult.sources,
      );
      return {
        answerType: "legal_information",
        confidence: Number(graphResult.confidence.toFixed(3)),
        issueClassification: {
          ...context.classification,
          subArea: initialIntent.taxonomySlug ?? context.classification.subArea,
          specificIssue: initialIntent.specificIssue ?? context.classification.specificIssue,
        },
        sources: graphResult.sources,
        directoryResults,
        directoryRows: directoryRows.length ? directoryRows : undefined,
        suggestedNextSteps: suggestedNextStepsForClassification(context.classification),
        clarifyingQuestion:
          graphResult.clarifyingQuestion ?? context.fusion.clarifyingQuestion ?? null,
        answer,
        answerMode: "graph_assembly",
        disclaimer: LEGAL_SEARCH_DISCLAIMER,
        searchCriteria,
        debug: {
          retrievalCount: graphResult.sources.length,
          rerankedCount: graphResult.sources.length,
          mode: "graph",
          intentSignals: initialIntent.signals,
          conceptCluster: [
            graphResult.conceptCluster.primary.wikiPageId,
            ...graphResult.conceptCluster.related.map((r) => r.wikiPageId),
          ],
          classificationFusion: fusionDebug(context),
          searchRouteMode: "legacy",
        },
      };
    }
  }

  let { chunks: retrieved, mode } = await hybridLegalRetrieval(query, {
    limit: 50,
    intent: initialIntent,
  });

  let intent = refineIntentFromChunks(initialIntent, retrieved.slice(0, 8));

  if (
    intent.taxonomySlug !== initialIntent.taxonomySlug &&
    intent.retrievalQueries[0] !== initialIntent.retrievalQueries[0] &&
    process.env.VERCEL !== "1"
  ) {
    const retry = await hybridLegalRetrieval(query, { limit: 50, intent });
    if (retry.chunks.length) {
      retrieved = retry.chunks;
      mode = retry.mode;
      intent = refineIntentFromChunks(intent, retrieved.slice(0, 8));
    }
  }

  if (retrieved.length < 3) {
    const wikiChunks = retrieveWikiAsChunks(query, { limit: 8, intent });
    if (wikiChunks.length) {
      const seen = new Set(retrieved.map((c) => c.documentId));
      const merged = [...retrieved];
      for (const chunk of wikiChunks) {
        if (seen.has(chunk.documentId)) continue;
        seen.add(chunk.documentId);
        merged.push(chunk);
      }
      retrieved = merged;
      mode = retrieved.length && mode !== "empty" ? mode : "lexical_only";
      intent = refineIntentFromChunks(intent, retrieved.slice(0, 8));
    }
  }

  const reranked = rerankLegalChunks(query, retrieved, {
    poolSize: 45,
    topK: 8,
    intent,
  });
  const answerPool = rankChunksForAnswer(query, retrieved).slice(0, 12);

  const confidenceResult = scoreRetrievalConfidence({
    query,
    chunks: reranked,
    classification: context.classification,
    intent,
  });

  const [answerResult, directorySlice] = await Promise.all([
    generateCitationFirstAnswer(query, answerPool, confidenceResult.score, intent),
    directoryPromise,
  ]);
  const { directoryResults, directoryRows } = directorySlice;

  const suggestedNextSteps = suggestedNextStepsForClassification(context.classification);
  if (
    (confidenceResult.level === "low" || confidenceResult.level === "medium") &&
    confidenceResult.clarifyingQuestion
  ) {
    suggestedNextSteps.unshift("Answer the clarifying question to improve source matching.");
  }

  const searchCriteria = decomposeLegalSearchQuery({
    query,
    location: input.location,
    jurisdiction,
    includeDirectory,
    context,
    intent,
  });

  let graphShadow: LegalSearchResponse["debug"] extends { graphShadow?: infer G } ? G : undefined;
  if (graphMode === "shadow" && isConsumerIntent(intent) && process.env.VERCEL !== "1") {
    const graphResult = await assembleFromKnowledgeGraph(context, intent);
    if (graphResult) {
      graphShadow = {
        graphAvailable: true,
        graphConfidence: graphResult.confidence,
        graphAnswerPreview: graphResult.answer.slice(0, 400),
        ragAnswerMode: answerResult.mode,
        conceptCluster: [
          graphResult.conceptCluster.primary.wikiPageId,
          ...graphResult.conceptCluster.related.map((r) => r.wikiPageId),
        ],
      };
    }
  }

  return {
    answerType: "legal_information",
    confidence: Number(confidenceResult.score.toFixed(3)),
    issueClassification: context.classification,
    sources: answerResult.sources,
    directoryResults,
    directoryRows: directoryRows.length ? directoryRows : undefined,
    suggestedNextSteps,
    clarifyingQuestion:
      confidenceResult.level === "low"
        ? confidenceResult.clarifyingQuestion ?? context.fusion.clarifyingQuestion ?? null
        : null,
    answer: answerResult.answer,
    answerMode: answerResult.mode,
    disclaimer: LEGAL_SEARCH_DISCLAIMER,
    searchCriteria,
    debug: {
      retrievalCount: retrieved.length,
      rerankedCount: reranked.length,
      mode,
      intentSignals: intent.signals,
      graphShadow,
      classificationFusion: fusionDebug(context),
      searchRouteMode: "legacy",
    },
  };
}

export async function runLegalKnowledgeSearch(
  input: LegalSearchRequest,
): Promise<LegalSearchResponse> {
  const context = await buildLegalSearchContext(input);
  const initialIntent = deriveLegalSearchIntent(context);
  const directoryPromise = runDirectorySlice(input, context, initialIntent);

  if (searchRouteMode() === "legacy") {
    return runLegacySearch(input, context, initialIntent, directoryPromise);
  }

  return runSatnavSearch(input, context, initialIntent, directoryPromise);
}
