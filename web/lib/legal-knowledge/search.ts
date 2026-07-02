import "server-only";

import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

import {
  classifyLegalIssue,
  suggestedNextStepsForClassification,
} from "./classify";
import { decomposeLegalSearchQuery } from "./decompose-query";
import { scoreRetrievalConfidence } from "./confidence";
import { rankChunksForAnswer } from "./clean-prose";
import { generateCitationFirstAnswer } from "./generate-answer";
import { directoryPracticeAreaFromQuery } from "./directory-practice-area";
import { hybridLegalRetrieval } from "./retrieval";
import { rerankLegalChunks } from "./rerank";
import type { LegalSearchRequest, LegalSearchResponse } from "./types";
import { LEGAL_SEARCH_DISCLAIMER } from "./types";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";

export async function runLegalKnowledgeSearch(
  input: LegalSearchRequest,
): Promise<LegalSearchResponse> {
  const query = input.query.trim();
  const includeDirectory = input.includeDirectory !== false;
  const jurisdiction = input.jurisdiction ?? "England and Wales";

  const classification = classifyLegalIssue(query);
  const resolution = resolveLegalIssueFromQuery(query);

  const { chunks: retrieved, mode } = await hybridLegalRetrieval(query, { limit: 50 });
  const reranked = rerankLegalChunks(query, retrieved, { poolSize: 45, topK: 8 });
  const answerPool = rankChunksForAnswer(query, retrieved).slice(0, 12);

  const confidenceResult = scoreRetrievalConfidence({
    query,
    chunks: reranked,
    classification,
  });

  const answerResult = await generateCitationFirstAnswer(
    query,
    answerPool,
    confidenceResult.score,
  );

  let directoryResults: LegalSearchResponse["directoryResults"] = [];
  let directoryRows: LegacyGetRow[] = [];
  if (includeDirectory) {
    try {
      const directory = await runDirectorySearch({
        query,
        limit: 8,
        semantic: true,
        location: input.location,
        practiceArea: directoryPracticeAreaFromQuery(query, resolution),
        legalAidOnly: resolution?.legalAidLikely || undefined,
        freeOnly: classification.urgency === "emergency" ? true : undefined,
      });

      const slice = directory.results.slice(0, 6);
      directoryRows = (directory.legacyRows ?? []).slice(0, 6) as LegacyGetRow[];

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
  }

  const suggestedNextSteps = suggestedNextStepsForClassification(classification);
  if (confidenceResult.level === "low" && confidenceResult.clarifyingQuestion) {
    suggestedNextSteps.unshift("Answer the clarifying question to improve source matching.");
  }

  const searchCriteria = decomposeLegalSearchQuery({
    query,
    location: input.location,
    jurisdiction,
    includeDirectory,
  });

  return {
    answerType: "legal_information",
    confidence: Number(confidenceResult.score.toFixed(3)),
    issueClassification: classification,
    sources: answerResult.sources,
    directoryResults,
    directoryRows: directoryRows.length ? directoryRows : undefined,
    suggestedNextSteps,
    clarifyingQuestion:
      confidenceResult.level === "low" ? confidenceResult.clarifyingQuestion : null,
    answer: answerResult.answer,
    answerMode: answerResult.mode,
    disclaimer: LEGAL_SEARCH_DISCLAIMER,
    searchCriteria,
    debug: {
      retrievalCount: retrieved.length,
      rerankedCount: reranked.length,
      mode,
    },
  };
}
