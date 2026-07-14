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
  filterDirectoryResultsByIntent,
  refineIntentFromChunks,
} from "./search-intent";
import type { LegalSearchRequest, LegalSearchResponse } from "./types";
import { LEGAL_SEARCH_DISCLAIMER } from "./types";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { toLegacyGetResponse } from "@/lib/legal-search/legacy-get-response";

type GraphMode = "primary" | "shadow" | "off";

const GRAPH_MIN_CONFIDENCE = 0.42;

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

async function runDirectorySlice(
  input: LegalSearchRequest,
  context: Awaited<ReturnType<typeof buildLegalSearchContext>>,
  intent: ReturnType<typeof deriveLegalSearchIntent>,
): Promise<{
  directoryResults: LegalSearchResponse["directoryResults"];
  directoryRows: LegacyGetRow[];
}> {
  let directoryResults: LegalSearchResponse["directoryResults"] = [];
  let directoryRows: LegacyGetRow[] = [];
  if (context.includeDirectory === false) {
    return { directoryResults, directoryRows };
  }
  try {
    const directory = await runDirectorySearch({
      query: intent.semanticQuery,
      limit: 8,
      semantic: true,
      location: input.location,
      practiceArea: intent.matcherSlug ?? intent.taxonomySlug,
      parsed: context.parsedQuery,
      searchIntent: intent,
      legalAidOnly: context.resolution?.legalAidLikely || undefined,
      freeOnly: context.classification.urgency === "emergency" ? true : undefined,
    });

    const filtered = filterDirectoryResultsByIntent(directory.results, intent);
    const slice = filtered.slice(0, 6);
    directoryRows = toLegacyGetResponse(slice).slice(0, 6) as LegacyGetRow[];

    directoryResults = slice.map((r) => ({
      id: r.id,
      title: r.displayName ?? r.title,
      source: r.sourceLabel ?? r.source,
      url: r.contact?.website?.trim() || undefined,
      locationLabel: r.locationLabel,
      explanation: r.explanation,
      score: Number(r.scores.final.toFixed(4)),
    }));
  } catch (err) {
    console.warn("[legal-knowledge.search] directory search failed:", err);
  }
  return { directoryResults, directoryRows };
}

export async function runLegalKnowledgeSearch(
  input: LegalSearchRequest,
): Promise<LegalSearchResponse> {
  const context = await buildLegalSearchContext(input);
  const { query, includeDirectory, jurisdiction } = context;

  const initialIntent = deriveLegalSearchIntent(context);
  const graphMode = knowledgeGraphMode();

  if (graphMode !== "off" && isConsumerIntent(initialIntent)) {
    const graphResult = await assembleFromKnowledgeGraph(context, initialIntent);
    if (
      graphResult &&
      graphMode === "primary" &&
      graphResult.confidence >= GRAPH_MIN_CONFIDENCE
    ) {
      const { directoryResults, directoryRows } = await runDirectorySlice(
        input,
        context,
        initialIntent,
      );
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
    intent.retrievalQueries[0] !== initialIntent.retrievalQueries[0]
  ) {
    const retry = await hybridLegalRetrieval(query, { limit: 50, intent });
    if (retry.chunks.length) {
      retrieved = retry.chunks;
      mode = retry.mode;
      intent = refineIntentFromChunks(intent, retrieved.slice(0, 8));
    }
  }

  const reranked = rerankLegalChunks(query, retrieved, { poolSize: 45, topK: 8 });
  const answerPool = rankChunksForAnswer(query, retrieved).slice(0, 12);

  const confidenceResult = scoreRetrievalConfidence({
    query,
    chunks: reranked,
    classification: context.classification,
    intent,
  });

  const answerResult = await generateCitationFirstAnswer(
    query,
    answerPool,
    confidenceResult.score,
    intent,
  );

  const { directoryResults, directoryRows } = await runDirectorySlice(input, context, intent);

  const suggestedNextSteps = suggestedNextStepsForClassification(context.classification);
  if (confidenceResult.level === "low" && confidenceResult.clarifyingQuestion) {
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
  if (graphMode === "shadow" && isConsumerIntent(intent)) {
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
