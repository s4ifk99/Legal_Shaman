import "server-only";

import { generateWikiAnswerFromHits } from "@/lib/wiki/generate-answer";
import { wikiPagePublicUrl } from "@/lib/wiki/public-url";

import { generateCitationFirstAnswer } from "./generate-answer";
import { scoreRetrievalConfidence } from "./confidence";
import { rankChunksForAnswer } from "./clean-prose";
import type { LegalSearchIntent } from "./search-intent";
import { satnavLlmEachStageEnabled } from "./route-llm-config";
import type { RouteArbitration } from "./route-types";
import type { LegalSearchSourceHit } from "./types";
import { LEGAL_SEARCH_DISCLAIMER } from "./types";
import { wikiPrimaryToResponse, type WikiPrimarySlice } from "./wiki-primary-answer";
import type { LegalSearchContext } from "./search-context";
import type { LegalSearchResponse } from "./types";

function confidenceFromWikiScore(retrievalScore: number, hasAnswer: boolean): number {
  if (hasAnswer) {
    return Math.min(0.95, Math.max(0.62, 0.45 + Math.min(retrievalScore, 80) / 120));
  }
  return Math.min(0.55, Math.max(0.3, retrievalScore / 100));
}

/**
 * One synthesis from arbiter-selected sources (wiki preferred; RAG chunks fallback).
 */
export async function synthesizeFromRouteArbitration(args: {
  query: string;
  arbitration: RouteArbitration;
  intent: LegalSearchIntent;
  context: LegalSearchContext;
  directoryResults: LegalSearchResponse["directoryResults"];
  directoryRows?: LegalSearchResponse["directoryRows"];
  suggestedNextSteps: string[];
  searchCriteria: LegalSearchResponse["searchCriteria"];
  forceLlm?: boolean;
}): Promise<{ response: LegalSearchResponse; wikiPayload?: import("@/lib/wiki/answer-types").WikiAnswerPayload }> {
  const {
    query,
    arbitration,
    intent,
    context,
    directoryResults,
    directoryRows,
    suggestedNextSteps,
    searchCriteria,
  } = args;

  const forceLlm = args.forceLlm === true || satnavLlmEachStageEnabled();

  const routeDebug = {
    searchRouteMode: "satnav" as const,
    routeDecision: arbitration.decision,
    chosenRouteIds: arbitration.chosenRouteIds,
    routeRationale: arbitration.rationale,
    routesConsidered: arbitration.routesConsidered,
  };

  if (arbitration.wikiHits.length > 0) {
    const payload = await generateWikiAnswerFromHits(query, arbitration.wikiHits, {
      forceLlm,
    });
    if (payload.mode === "synthesis" && payload.answer?.trim()) {
      const wiki: WikiPrimarySlice = {
        answer: payload.answer.trim(),
        answerMode: "synthesis",
        confidence: Math.max(
          arbitration.confidence,
          confidenceFromWikiScore(payload.retrievalScore, true),
        ),
        sources: arbitration.sources.length
          ? arbitration.sources
          : payload.wikiPages.slice(0, 8).map((hit, i) => ({
              title: hit.title,
              url: wikiPagePublicUrl(hit.id),
              source: "Legal Shaman Wiki",
              snippet: (hit.summary || "").slice(0, 240),
              score: Number(Math.max(0.4, 1 - i * 0.06).toFixed(4)),
              heading: hit.category || null,
            })),
        disclaimer: payload.disclaimer || LEGAL_SEARCH_DISCLAIMER,
        wikiPageIds: payload.wikiPages.map((p) => p.id),
        retrievalScore: payload.retrievalScore,
      };

      // Ensure wiki sources have public URLs when arbiter already set them
      if (arbitration.sources.length) {
        wiki.sources = arbitration.sources as LegalSearchSourceHit[];
      }

      const response = wikiPrimaryToResponse({
        wiki,
        context,
        intent,
        directoryResults,
        directoryRows,
        suggestedNextSteps,
        searchCriteria,
      });
      return {
        response: {
          ...response,
          debug: {
            ...response.debug!,
            ...routeDebug,
            mode: "wiki",
          },
        },
        wikiPayload: payload,
      };
    }
  }

  if (arbitration.chunks.length > 0) {
    const confidenceResult = scoreRetrievalConfidence({
      query,
      chunks: arbitration.chunks,
      classification: context.classification,
      intent,
    });
    const answerPool = rankChunksForAnswer(query, arbitration.chunks).slice(0, 12);
    const answerResult = await generateCitationFirstAnswer(
      query,
      answerPool,
      confidenceResult.score,
      intent,
    );
    return {
      response: {
        answerType: "legal_information",
        confidence: Number(
          Math.max(arbitration.confidence, confidenceResult.score).toFixed(3),
        ),
        issueClassification: {
          ...context.classification,
          subArea: intent.taxonomySlug ?? context.classification.subArea,
          specificIssue: intent.specificIssue ?? context.classification.specificIssue,
        },
        sources: answerResult.sources.length ? answerResult.sources : arbitration.sources,
        directoryResults,
        directoryRows: directoryRows?.length ? directoryRows : undefined,
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
          retrievalCount: arbitration.chunks.length,
          rerankedCount: answerPool.length,
          mode: "hybrid",
          intentSignals: intent.signals,
          classificationFusion: {
            fusionSource: context.fusion.fusionSource,
            ruleTaxonomySlug: context.fusion.ruleTaxonomySlug,
            llmTaxonomySlug: context.fusion.llmTaxonomySlug,
            ruleMatchStrength: context.fusion.ruleMatchStrength,
            llmConfidence: context.fusion.llmConfidence,
            phraseCandidates: context.fusion.phraseCandidates,
          },
          ...routeDebug,
        },
      },
    };
  }

  return {
    response: {
      answerType: "legal_information",
      confidence: 0.25,
      issueClassification: context.classification,
      sources: [],
      directoryResults,
      directoryRows: directoryRows?.length ? directoryRows : undefined,
      suggestedNextSteps,
      clarifyingQuestion: context.fusion.clarifyingQuestion ?? null,
      answer: null,
      answerMode: "fallback",
      disclaimer: LEGAL_SEARCH_DISCLAIMER,
      searchCriteria,
      debug: {
        retrievalCount: 0,
        rerankedCount: 0,
        mode: "empty",
        intentSignals: intent.signals,
        ...routeDebug,
      },
    },
  };
}
