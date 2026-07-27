import "server-only";

import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import {
  assembleFromKnowledgeGraph,
  graphAssemblySourcesWithCitations,
} from "@/lib/knowledge-compiler/assemble-answer";
import { isConsumerIntent } from "@/lib/knowledge-compiler/page-index";

import {
  classifyLegalIssue,
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

  const directoryTimeoutMs = Number(
    process.env.LEGAL_DIRECTORY_TIMEOUT_MS ?? (process.env.VERCEL === "1" ? 3_500 : 15_000),
  );

  const run = async (): Promise<DirectorySlice> => {
    const shortQ =
      intent.canonicalName && intent.specificIssue
        ? `${intent.canonicalName} ${intent.specificIssue}`.slice(0, 80)
        : intent.canonicalName
          ? `${intent.canonicalName} solicitor`.slice(0, 80)
          : intent.semanticQuery.slice(0, 80);
    const directory = await runDirectorySearch({
      query: shortQ,
      limit: 8,
      semantic: false,
      location: input.location,
      practiceArea: directoryPracticeAreaForIntent(intent),
      parsed: context.parsedQuery,
      searchIntent: intent,
      legalAidOnly: context.resolution?.legalAidLikely || undefined,
      freeOnly: context.classification.urgency === "emergency" ? true : undefined,
    });

    const filtered = filterDirectoryResultsByIntent(directory.results, intent);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    return await Promise.race([
      run(),
      new Promise<DirectorySlice>((resolve) => {
        timer = setTimeout(() => resolve(EMPTY_DIRECTORY), directoryTimeoutMs);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  } catch (err) {
    console.warn("[legal-knowledge.search] directory search failed:", err);
    return EMPTY_DIRECTORY;
  }
}

export async function runLegalKnowledgeSearch(
  input: LegalSearchRequest,
): Promise<LegalSearchResponse> {
  const context = await buildLegalSearchContext(input);
  const { query, includeDirectory, jurisdiction } = context;

  const initialIntent = deriveLegalSearchIntent(context);
  const graphMode = knowledgeGraphMode();

  // Start directory in parallel for graph/RAG paths only — wiki synthesis can exceed the
  // directory timeout if both race from t=0 (was returning 0 lawyers on production).
  let directoryPromise: Promise<DirectorySlice> | undefined;

  const wikiPrimary = await tryWikiPrimaryAnswer(processSearchQuery(query));
  if (wikiPrimary) {
    const directorySlice = await runDirectorySlice(input, context, initialIntent);
    const searchCriteria = decomposeLegalSearchQuery({
      query,
      location: input.location,
      jurisdiction,
      includeDirectory,
      context,
      intent: initialIntent,
    });
    return wikiPrimaryToResponse({
      wiki: wikiPrimary,
      context,
      intent: initialIntent,
      directoryResults: directorySlice.directoryResults,
      directoryRows: directorySlice.directoryRows,
      suggestedNextSteps: suggestedNextStepsForClassification(context.classification),
      searchCriteria,
    });
  }

  directoryPromise = runDirectorySlice(input, context, initialIntent);

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

  // Align with /api/ask wiki path when chunk DB is empty/sparse (common on Vercel).
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
    },
  };
}
