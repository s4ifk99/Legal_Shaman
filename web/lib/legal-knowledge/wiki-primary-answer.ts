import "server-only";

import { wikiPagePublicUrl } from "@/lib/wiki/public-url";
import { generateWikiAnswer } from "@/lib/wiki/generate-answer";
import type { WikiAnswerPayload } from "@/lib/wiki/answer-types";

import type { LegalSearchContext } from "./search-context";
import type { LegalSearchIntent } from "./search-intent";
import type { LegalSearchResponse, LegalSearchSourceHit } from "./types";
import { LEGAL_SEARCH_DISCLAIMER } from "./types";

const MIN_WIKI_RETRIEVAL = 4;

function confidenceFromWiki(payload: WikiAnswerPayload): number {
  // Wiki hit scores are keyword sums; strong cancel/trader matches are often 20–80+.
  const score = payload.retrievalScore;
  if (payload.mode === "synthesis" && payload.answer) {
    return Math.min(0.95, Math.max(0.62, 0.45 + Math.min(score, 80) / 120));
  }
  return Math.min(0.55, Math.max(0.3, score / 100));
}

function sourcesFromWiki(payload: WikiAnswerPayload): LegalSearchSourceHit[] {
  return payload.wikiPages.slice(0, 8).map((hit, i) => ({
    title: hit.title,
    url: wikiPagePublicUrl(hit.id),
    source: "Legal Shaman Wiki",
    snippet: (hit.summary || hit.keyInformation[0] || "").slice(0, 240),
    score: Number(Math.max(0.4, 1 - i * 0.06).toFixed(4)),
    heading: hit.category || null,
  }));
}

export type WikiPrimarySlice = {
  answer: string;
  answerMode: "synthesis";
  confidence: number;
  sources: LegalSearchSourceHit[];
  disclaimer: string;
  wikiPageIds: string[];
  retrievalScore: number;
};

/**
 * Preferred guidance path: same generator as local wiki `/api/ask/answer`.
 * Returns null when wiki has nothing usable so graph/RAG can continue.
 */
export async function tryWikiPrimaryAnswer(
  query: string,
): Promise<WikiPrimarySlice | null> {
  const payload = await generateWikiAnswer(query);
  if (payload.mode !== "synthesis" || !payload.answer?.trim()) return null;
  if (payload.retrievalScore < MIN_WIKI_RETRIEVAL || payload.wikiPages.length === 0) {
    return null;
  }

  return {
    answer: payload.answer.trim(),
    answerMode: "synthesis",
    confidence: confidenceFromWiki(payload),
    sources: sourcesFromWiki(payload),
    disclaimer: payload.disclaimer || LEGAL_SEARCH_DISCLAIMER,
    wikiPageIds: payload.wikiPages.map((p) => p.id),
    retrievalScore: payload.retrievalScore,
  };
}

export function wikiPrimaryToResponse(args: {
  wiki: WikiPrimarySlice;
  context: LegalSearchContext;
  intent: LegalSearchIntent;
  directoryResults: LegalSearchResponse["directoryResults"];
  directoryRows?: LegalSearchResponse["directoryRows"];
  suggestedNextSteps: string[];
  searchCriteria: LegalSearchResponse["searchCriteria"];
}): LegalSearchResponse {
  const { wiki, context, intent, directoryResults, directoryRows, suggestedNextSteps, searchCriteria } =
    args;

  return {
    answerType: "legal_information",
    confidence: Number(wiki.confidence.toFixed(3)),
    issueClassification: {
      ...context.classification,
      subArea: intent.taxonomySlug ?? context.classification.subArea,
      specificIssue: intent.specificIssue ?? context.classification.specificIssue,
    },
    sources: wiki.sources,
    directoryResults,
    directoryRows: directoryRows?.length ? directoryRows : undefined,
    suggestedNextSteps,
    clarifyingQuestion: null,
    answer: wiki.answer,
    answerMode: wiki.answerMode,
    disclaimer: wiki.disclaimer,
    searchCriteria,
    debug: {
      retrievalCount: wiki.sources.length,
      rerankedCount: wiki.sources.length,
      mode: "wiki",
      intentSignals: intent.signals,
      conceptCluster: wiki.wikiPageIds.slice(0, 8),
    },
  };
}
