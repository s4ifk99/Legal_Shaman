import { prisma } from "@/lib/db/prisma";
import { embedConfigured, embedOne, toPgVectorLiteral } from "@/lib/llm/client";
import { getWikiIndex } from "@/lib/wiki/load-index";

import { isKnowledgeGraphDbReady } from "./db-ready";
import { wikiAreaForTaxonomy } from "./taxonomy-map";

/** Cosine similarity scores for wiki pages whose concept summaries are embedded. */
export async function embeddingScoresForQuery(
  query: string,
  opts?: { taxonomySlug?: string; limit?: number },
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  // Vercel: skip remote embeddings (latency / home-DB vector lookups).
  if (process.env.VERCEL === "1") return scores;
  if (!(await isKnowledgeGraphDbReady()) || !embedConfigured()) return scores;

  const embedding = await embedOne(query.slice(0, 2000));
  const literal = toPgVectorLiteral(embedding);
  const limit = opts?.limit ?? 12;
  const area = opts?.taxonomySlug ? wikiAreaForTaxonomy(opts.taxonomySlug) : null;

  const rows = await prisma.$queryRaw<Array<{ wiki_page_id: string; score: number }>>`
    SELECT wiki_page_id, GREATEST(0, 1 - (embedding <=> ${literal}::vector))::float8 AS score
    FROM knowledge_concepts
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit * 4}
  `;

  const index = getWikiIndex();
  for (const row of rows) {
    if (scores.size >= limit) break;
    const page = index.pages.find((p) => p.id === row.wiki_page_id);
    if (!page) continue;
    if (area && page.category !== area) continue;
    if (opts?.taxonomySlug && row.score < 0.35) continue;
    scores.set(row.wiki_page_id, row.score);
  }

  return scores;
}
