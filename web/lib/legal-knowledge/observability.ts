import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { IssueClassification } from "@/lib/legal-knowledge/types";

import type { ClassificationFusion } from "./classify-fusion";

type LogLegalKnowledgeArgs = {
  sessionId?: string;
  query: string;
  issueClassification: IssueClassification;
  taxonomySlug?: string;
  specificIssue?: string;
  intentConfidence?: string;
  intentSignals?: string[];
  answerMode?: string;
  conceptCluster?: string[];
  clarifyingAsked: boolean;
  sourceUrls: string[];
  directoryIds: string[];
  confidence: number;
  latencyMs?: number;
  degradedModes?: string[];
  fusion?: ClassificationFusion;
};

/** Persists Ask the Shaman legal knowledge search telemetry for gap mining. */
export async function logLegalKnowledgeInteraction(args: LogLegalKnowledgeArgs): Promise<void> {
  try {
    await prisma.searchInteraction.create({
      data: {
        userSessionId: args.sessionId ?? null,
        rawQuery: args.query.slice(0, 2000),
        extractedFilters: {
          channel: "legal_knowledge",
          confidence: args.confidence,
          issueClassification: args.issueClassification,
          intentSignals: args.intentSignals ?? [],
          sourceUrls: args.sourceUrls.slice(0, 20),
          answerMode: args.answerMode,
          conceptCluster: args.conceptCluster?.slice(0, 12),
          fusionSource: args.fusion?.fusionSource,
        } as object,
        clarifyingAsked: args.clarifyingAsked,
        resultLawyerIds: [],
        channel: "legal_knowledge",
        latencyMs: args.latencyMs ?? null,
        degradedModes: args.degradedModes?.length ? args.degradedModes : undefined,
        resultCount: args.sourceUrls.length,
        parsedQuery: {
          taxonomySlug: args.taxonomySlug ?? args.issueClassification.subArea,
          specificIssue: args.specificIssue ?? args.issueClassification.specificIssue,
          queryConfidence: args.intentConfidence,
          intentSignals: args.intentSignals,
          fusionSource: args.fusion?.fusionSource,
          ruleTaxonomySlug: args.fusion?.ruleTaxonomySlug,
          ruleMatchStrength: args.fusion?.ruleMatchStrength,
          llmTaxonomySlug: args.fusion?.llmTaxonomySlug,
          llmConfidence: args.fusion?.llmConfidence,
          phraseCandidates: args.fusion?.phraseCandidates,
        } as object,
        unifiedResultIds: args.directoryIds.slice(0, 30),
      },
    });
  } catch (err) {
    console.warn("[legal-knowledge.observability] SearchInteraction log failed:", err);
  }
}
