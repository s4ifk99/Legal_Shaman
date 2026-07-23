import "server-only";

import { prisma } from "@/lib/db/prisma";
import { embedOne, embedConfigured, toPgVectorLiteral } from "@/lib/llm/client";
import { buildExpandedSearchText } from "@/lib/legal/taxonomy";

import {
  authorityForDomain,
  freshnessScoreFromDate,
  isMarketingContent,
} from "./authority";
import { buildSnippet } from "./chunker";
import type { LegalSearchIntent } from "./search-intent";
import type { RetrievedChunk } from "./types";
import { normalizeLegalSourceUrl } from "@/lib/wiki/public-url";

const LEXICAL_POOL = 50;
const VECTOR_POOL = 50;
const MERGE_LIMIT = 60;

type RawRow = {
  id: string;
  document_id: string;
  source_url: string;
  title: string;
  heading: string | null;
  chunk_text: string;
  chunk_index: number;
  token_count: number;
  fetched_at: Date;
  source_updated_at: Date | null;
  domain: string;
  source_name: string;
  authority_weight: number;
  lexical_score: number;
  vector_score: number;
};

export type RetrievalOptions = {
  limit?: number;
  jurisdiction?: string;
  intent?: LegalSearchIntent;
};

function extractPhrases(query: string, boostTerms: string[]): string[] {
  const phrases = new Set<string>();
  const quoted = [...query.matchAll(/"([^"]{3,80})"/g)].map((m) => m[1]!.toLowerCase());
  for (const q of quoted) phrases.add(q);
  for (const term of boostTerms) {
    const t = term.trim().toLowerCase();
    if (t.length >= 4) phrases.add(t);
  }
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 5);
  for (let i = 0; i < words.length - 1; i++) {
    phrases.add(`${words[i]} ${words[i + 1]}`);
  }
  return [...phrases].slice(0, 12);
}

function phraseScore(chunkText: string, phrases: string[]): number {
  if (!phrases.length) return 0;
  const lower = chunkText.toLowerCase();
  let hits = 0;
  for (const ph of phrases) {
    if (lower.includes(ph)) hits += Math.min(ph.length / 20, 1.5);
  }
  return Math.min(1, hits / Math.max(phrases.length * 0.35, 1));
}

function normalizeLexical(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(1, score / 0.15);
}

function scoreRow(
  row: RawRow,
  phrases: string[],
  query: string,
  intent?: LegalSearchIntent,
): Omit<RetrievedChunk, "snippet" | "finalScore"> & { marketingPenalty: number } {
  const authorityScore = Math.min(1, row.authority_weight);
  const freshnessScore = freshnessScoreFromDate(row.fetched_at, row.source_updated_at);
  const lexicalScore = normalizeLexical(row.lexical_score);
  const vectorScore = Math.max(0, Math.min(1, row.vector_score));
  const phraseMatchScore = phraseScore(row.chunk_text, phrases);
  const marketingPenalty = isMarketingContent(row.chunk_text) ? 0.35 : 0;

  const titleLower = row.title.toLowerCase();
  const blobLower = `${titleLower} ${row.source_url.toLowerCase()}`;
  let titleBoost = 0;

  if (intent?.requiredTopicTerms.length) {
    const onTopic = intent.requiredTopicTerms.some((t) => blobLower.includes(t.toLowerCase()));
    if (onTopic) titleBoost += 0.35;
    const isWikiIndex = /—\s*sources$/i.test(row.title) || /—\s*key information$/i.test(row.title);
    if (isWikiIndex && !onTopic) titleBoost -= 0.3;
    if (/money,\s*benefits|universal credit|welfare benefits/i.test(blobLower) && !onTopic) {
      titleBoost -= 0.25;
    }
  }

  if (intent?.suppressTerms.length) {
    const suppressed = intent.suppressTerms.some((t) => blobLower.includes(t.toLowerCase()));
    const onTopic = intent.requiredTopicTerms.some((t) => blobLower.includes(t.toLowerCase()));
    if (suppressed && !onTopic) titleBoost -= 0.2;
  }

  const qLower = query.toLowerCase();
  if (/\bdeposit\b/.test(qLower) && /\bdeposit\b/.test(titleLower)) titleBoost += 0.4;
  if (/\bevict/.test(qLower) && /\bevict|possession/.test(titleLower)) titleBoost += 0.3;
  if (/\bdisrepair|damp|mould|repair\b/.test(qLower) && /\brepair|disrepair|damp|mould/.test(titleLower)) {
    titleBoost += 0.3;
  }

  const relevanceScore =
    lexicalScore * 0.32 +
    vectorScore * 0.38 +
    phraseMatchScore * 0.2 +
    authorityScore * 0.05 +
    freshnessScore * 0.05 +
    titleBoost;

  return {
    id: row.id,
    documentId: row.document_id,
    sourceUrl: normalizeLegalSourceUrl(row.source_url),
    title: row.title,
    heading: row.heading,
    chunkText: row.chunk_text,
    chunkIndex: row.chunk_index,
    tokenCount: row.token_count,
    domain: row.domain,
    sourceName: row.source_name,
    authorityWeight: row.authority_weight,
    fetchedAt: row.fetched_at,
    sourceUpdatedAt: row.source_updated_at,
    relevanceScore,
    authorityScore,
    freshnessScore,
    lexicalScore,
    vectorScore,
    phraseScore: phraseMatchScore,
    marketingPenalty,
    finalScore: 0,
  };
}

function buildLexicalQuery(raw: string, intent?: LegalSearchIntent): string {
  if (intent?.retrievalQueries[0]?.trim()) {
    return intent.retrievalQueries[0]!.trim().slice(0, 300);
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function hybridLegalRetrieval(
  query: string,
  options: RetrievalOptions = {},
): Promise<{ chunks: RetrievedChunk[]; mode: "hybrid" | "lexical_only" | "empty" }> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { chunks: [], mode: "empty" };

  const intent = options.intent;
  const expanded =
    intent?.retrievalQueries[0]?.trim() ||
    buildExpandedSearchText(null, trimmed);
  const boostTerms = intent?.searchBoostTerms ?? [];
  const phrases = extractPhrases(expanded, boostTerms);
  const lexicalQuery = buildLexicalQuery(trimmed, intent);

  const lexicalRows = await prisma.$queryRaw<
    Array<{
      id: string;
      document_id: string;
      source_url: string;
      title: string;
      heading: string | null;
      chunk_text: string;
      chunk_index: number;
      token_count: number;
      fetched_at: Date;
      source_updated_at: Date | null;
      domain: string;
      source_name: string;
      authority_weight: number;
      lexical_score: number;
    }>
  >`
    SELECT
      lc.id,
      lc.document_id,
      lc.source_url,
      lc.title,
      lc.heading,
      lc.chunk_text,
      lc.chunk_index,
      lc.token_count,
      lc.fetched_at,
      ld.source_updated_at,
      ld.domain,
      ls.name AS source_name,
      ls.authority_weight,
      ts_rank_cd(
        to_tsvector('english', coalesce(lc.heading, '') || ' ' || lc.chunk_text),
        websearch_to_tsquery('english', ${lexicalQuery})
      )::float8 AS lexical_score
    FROM legal_chunks lc
    JOIN legal_documents ld ON ld.id = lc.document_id
    JOIN legal_sources ls ON ls.id = ld.source_id
    WHERE to_tsvector('english', coalesce(lc.heading, '') || ' ' || lc.chunk_text)
      @@ websearch_to_tsquery('english', ${lexicalQuery})
    ORDER BY lexical_score DESC
    LIMIT ${LEXICAL_POOL}
  `;

  let vectorRows: Array<{
    id: string;
    document_id: string;
    source_url: string;
    title: string;
    heading: string | null;
    chunk_text: string;
    chunk_index: number;
    token_count: number;
    fetched_at: Date;
    source_updated_at: Date | null;
    domain: string;
    source_name: string;
    authority_weight: number;
    vector_score: number;
  }> = [];

  let mode: "hybrid" | "lexical_only" | "empty" = "lexical_only";

  if (embedConfigured() && process.env.VERCEL !== "1") {
    try {
      const embedding = await embedOne(expanded);
      const literal = toPgVectorLiteral(embedding);
      vectorRows = await prisma.$queryRaw`
        SELECT
          lc.id,
          lc.document_id,
          lc.source_url,
          lc.title,
          lc.heading,
          lc.chunk_text,
          lc.chunk_index,
          lc.token_count,
          lc.fetched_at,
          ld.source_updated_at,
          ld.domain,
          ls.name AS source_name,
          ls.authority_weight,
          GREATEST(0, 1 - (lc.embedding <=> ${literal}::vector))::float8 AS vector_score
        FROM legal_chunks lc
        JOIN legal_documents ld ON ld.id = lc.document_id
        JOIN legal_sources ls ON ls.id = ld.source_id
        WHERE lc.embedding IS NOT NULL
        ORDER BY lc.embedding <=> ${literal}::vector
        LIMIT ${VECTOR_POOL}
      `;
      if (vectorRows.length > 0) mode = "hybrid";
    } catch (err) {
      console.warn("[legal-knowledge.retrieval] vector search failed:", err);
    }
  }

  const merged = new Map<string, RawRow>();

  for (const row of lexicalRows) {
    merged.set(row.id, {
      ...row,
      vector_score: 0,
    });
  }

  for (const row of vectorRows) {
    const existing = merged.get(row.id);
    if (existing) {
      existing.vector_score = Math.max(existing.vector_score, row.vector_score);
    } else {
      merged.set(row.id, {
        ...row,
        lexical_score: 0,
      });
    }
  }

  if (!merged.size) return { chunks: [], mode: "empty" };

  const scored = [...merged.values()]
    .map((row) => scoreRow(row, phrases, trimmed, intent))
    .map((row) => {
      const finalScore =
        row.relevanceScore * 0.72 +
        row.authorityScore * 0.15 +
        row.freshnessScore * 0.08 +
        row.phraseScore * 0.05 -
        row.marketingPenalty;
      return {
        ...row,
        finalScore: Math.max(0, finalScore),
        snippet: buildSnippet(row.chunkText),
      } satisfies RetrievedChunk;
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, options.limit ?? MERGE_LIMIT);

  return { chunks: scored, mode };
}

/** Fallback when DB join metadata is missing — infer authority from URL domain. */
export function enrichChunkAuthority(chunk: RetrievedChunk): RetrievedChunk {
  if (chunk.authorityWeight > 0) return chunk;
  const { name, authorityWeight } = authorityForDomain(chunk.domain);
  return {
    ...chunk,
    sourceName: name,
    authorityWeight,
    authorityScore: Math.min(1, authorityWeight),
  };
}
