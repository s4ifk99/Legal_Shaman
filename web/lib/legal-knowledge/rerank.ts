import { wikiAreaForTaxonomy } from "@/lib/knowledge-compiler/taxonomy-map";
import { isMarketingContent } from "./authority";
import type { LegalSearchIntent } from "./search-intent";
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
  intent?: LegalSearchIntent;
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

function topicAgreementScore(chunk: RetrievedChunk, intent?: LegalSearchIntent): number {
  const terms = intent?.requiredTopicTerms ?? [];
  if (!terms.length) return 0.5;
  const blob = `${chunk.title} ${chunk.heading ?? ""} ${chunk.chunkText} ${chunk.sourceUrl}`.toLowerCase();
  return terms.some((t) => blob.includes(t.toLowerCase())) ? 1 : 0.15;
}

function areaPathBoost(chunk: RetrievedChunk, intent?: LegalSearchIntent): number {
  const area = wikiAreaForTaxonomy(intent?.taxonomySlug);
  if (!area) return 0;
  const blob = `${chunk.sourceUrl} ${chunk.title}`.toLowerCase();
  const areaSlug = area.toLowerCase();
  if (blob.includes(`areas/${areaSlug}`) || blob.includes(areaSlug)) return 0.28;
  if (blob.includes("/concepts/") || blob.includes("reference/concepts")) return 0.12;
  return 0;
}

function firmDirectoryPenalty(chunk: RetrievedChunk): number {
  const blob = `${chunk.sourceUrl} ${chunk.title}`.toLowerCase();
  if (
    blob.includes("directory/firms") ||
    blob.includes("/firms/") ||
    (blob.includes("directory/") && blob.includes("firm"))
  ) {
    return 0.32;
  }
  return 0;
}

/** Heuristic reranker — prefers official UK guidance over marketing pages. */
export function rerankLegalChunks(
  query: string,
  chunks: RetrievedChunk[],
  options: RerankOptions = {},
): RetrievedChunk[] {
  const poolSize = options.poolSize ?? 40;
  const topK = options.topK ?? 8;
  const intent = options.intent;
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
      bonus += topicAgreementScore(chunk, intent) * 0.18;
      bonus += areaPathBoost(chunk, intent);

      if (isMarketingContent(text)) penalty += 0.35;
      if (OUTDATED_SIGNALS.test(text)) penalty += 0.15;
      if (chunk.lexicalScore < 0.05 && chunk.vectorScore < 0.35) penalty += 0.12;
      penalty += firmDirectoryPenalty(chunk);

      if (intent?.requiredTopicTerms.length && topicAgreementScore(chunk, intent) < 0.5) {
        penalty += 0.18;
      }

      const finalScore = Math.max(0, chunk.finalScore + bonus - penalty);
      return { ...chunk, finalScore };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

  return reranked.slice(0, topK);
}
