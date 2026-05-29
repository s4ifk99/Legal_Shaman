import "server-only";

import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { sortByFinalScore, type RerankSearchOptions } from "@/lib/legal-search/rerank";
import { enableOpenReranker } from "@/lib/legal-search/config";
import {
  openRerankerConfigured,
  openRerankerMaxDelta,
} from "@/lib/legal-search/open-reranker/config";
import {
  buildOpenRerankerDocumentText,
  buildOpenRerankerQueryText,
} from "@/lib/legal-search/open-reranker/document-text";
import { scoreOpenRerankerPairs } from "@/lib/legal-search/open-reranker/client";
import { rerankerInfluenceGate } from "@/lib/legal-search/open-reranker/blend-gates";
import { isUrgentSearchQuery } from "@/lib/provider-intelligence/provider-capability-ranker";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeBatchScores(scores: number[]): number[] {
  if (!scores.length) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min || 1;
  return scores.map((s) => clamp01((s - min) / span));
}

export type OpenRerankerBlendMeta = {
  rerankerModel: string;
  rerankerDegraded: boolean;
};

export type ApplyOpenRerankerBlendArgs = {
  userQuery: string;
  parsed: ParsedQuery;
  opts?: RerankSearchOptions;
  preRankIndexById: Map<string, number>;
};

/**
 * Cross-encoder rerank on top of weighted directory scores (taxonomy, location, behavioural, etc.).
 * Source-diversity and capability passes run after this — they are not overridden here.
 */
export async function applyOpenRerankerBlend(
  results: SearchResult[],
  args: ApplyOpenRerankerBlendArgs,
): Promise<{ results: SearchResult[]; meta: OpenRerankerBlendMeta | null }> {
  if (!enableOpenReranker() || !openRerankerConfigured() || results.length === 0) {
    return { results, meta: null };
  }

  const { userQuery, parsed, opts, preRankIndexById } = args;
  const queryText = buildOpenRerankerQueryText(userQuery, parsed);
  const pairs: [string, string][] = results.map((r) => [
    queryText,
    buildOpenRerankerDocumentText(r, parsed),
  ]);

  const scored = await scoreOpenRerankerPairs(pairs);
  const normalized = normalizeBatchScores(scored.scores);
  const maxDelta = openRerankerMaxDelta();
  const urgentIntent =
    isUrgentSearchQuery(parsed.semanticQuery) || parsed.intent === "emergency";

  const adjusted = results.map((r, i) => {
    const preRerankRank = preRankIndexById.get(r.id) ?? i + 1;
    const norm = normalized[i] ?? 0.5;
    const gate = rerankerInfluenceGate(r, parsed, { ...opts, urgentIntent });
    const centered = (norm - 0.5) * 2;
    const delta = centered * maxDelta * gate;
    const scores = {
      ...r.scores,
      reranker: clamp01(norm),
      final: clamp01(r.scores.final + delta),
    };

    const raw = (r.raw && typeof r.raw === "object" ? { ...(r.raw as object) } : {}) as Record<
      string,
      unknown
    >;
    raw._openReranker = {
      rerankerModel: scored.model,
      rerankerScore: norm,
      rawRerankerScore: scored.scores[i],
      preRerankRank,
      rerankerDegraded: scored.degraded,
    };

    return { ...r, scores, raw };
  });

  const sorted = sortByFinalScore(adjusted);
  const withPostRank = sorted.map((r, i) => {
    const raw = (r.raw && typeof r.raw === "object" ? { ...(r.raw as object) } : {}) as Record<
      string,
      unknown
    >;
    const prev = (raw._openReranker as Record<string, unknown> | undefined) ?? {};
    raw._openReranker = { ...prev, postRerankRank: i + 1 };
    return { ...r, raw };
  });

  return {
    results: withPostRank,
    meta: { rerankerModel: scored.model, rerankerDegraded: scored.degraded },
  };
}
