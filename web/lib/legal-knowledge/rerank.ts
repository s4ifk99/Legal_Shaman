import { isMarketingContent } from "./authority";
import type { RetrievedChunk } from "./types";

const UK_SIGNALS =
  /\b(uk|united kingdom|england|wales|scotland|northern ireland|tribunal|citizens advice|gov\.uk|legal aid|solicitor regulation authority)\b/i;
const NON_UK_PENALTY =
  /\b(us law|american|california|new york|european union directive only|australia|canada)\b/i;
const PRACTICAL_SIGNALS =
  /\b(how to|you can|apply|form|deadline|time limit|step|checklist|contact|helpline|template|example)\b/i;
const OUTDATED_SIGNALS =
  /\b(201[0-5]|brexit transition period ends|covid-19 temporary measures)\b/i;

export type RerankOptions = {
  topK?: number;
  poolSize?: number;
};

function ukRelevanceScore(text: string): number {
  if (NON_UK_PENALTY.test(text)) return 0.15;
  if (UK_SIGNALS.test(text)) return 1;
  return 0.65;
}

function practicalGuidanceScore(text: string): number {
  return PRACTICAL_SIGNALS.test(text) ? 1 : 0.45;
}

function directAnswerScore(query: string, chunk: RetrievedChunk): number {
  const qTokens = new Set(
    query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 4),
  );
  if (!qTokens.size) return 0.4;
  const text = `${chunk.title} ${chunk.heading ?? ""} ${chunk.chunkText}`.toLowerCase();
  let hits = 0;
  for (const t of qTokens) {
    if (text.includes(t)) hits += 1;
  }
  return Math.min(1, hits / Math.max(qTokens.size * 0.45, 1));
}

/** Heuristic reranker — prefers official UK guidance over marketing pages. */
export function rerankLegalChunks(
  query: string,
  chunks: RetrievedChunk[],
  options: RerankOptions = {},
): RetrievedChunk[] {
  const poolSize = options.poolSize ?? 40;
  const topK = options.topK ?? 8;
  const pool = chunks.slice(0, poolSize);

  const reranked = pool
    .map((chunk) => {
      const text = `${chunk.title}\n${chunk.chunkText}`;
      let bonus = 0;
      let penalty = 0;

      bonus += chunk.authorityScore * 0.22;
      bonus += chunk.freshnessScore * 0.1;
      bonus += ukRelevanceScore(text) * 0.18;
      bonus += practicalGuidanceScore(text) * 0.12;
      bonus += directAnswerScore(query, chunk) * 0.2;

      if (isMarketingContent(text)) penalty += 0.35;
      if (OUTDATED_SIGNALS.test(text)) penalty += 0.15;
      if (chunk.lexicalScore < 0.05 && chunk.vectorScore < 0.35) penalty += 0.12;

      const finalScore = Math.max(0, chunk.finalScore + bonus - penalty);
      return { ...chunk, finalScore };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

  return reranked.slice(0, topK);
}
