import { prisma } from "@/lib/db/prisma";
import { embed, embedConfigured, toPgVectorLiteral } from "@/lib/llm/client";

const EMBED_BATCH = 32;

export async function embedLegalChunks(chunkIds?: string[]): Promise<number> {
  if (!embedConfigured()) {
    console.warn("[legal-knowledge.embed] LLM_API_KEY not set — skipping embeddings");
    return 0;
  }

  const rows = chunkIds?.length
    ? await prisma.legalChunk.findMany({
        where: { id: { in: chunkIds }, embedding: null },
        select: { id: true, title: true, heading: true, chunkText: true },
      })
    : await prisma.$queryRaw<Array<{ id: string; title: string; heading: string | null; chunk_text: string }>>`
        SELECT id, title, heading, chunk_text
        FROM legal_chunks
        WHERE embedding IS NULL
        ORDER BY created_at ASC
        LIMIT 500
      `.then((raw) =>
        raw.map((r) => ({
          id: r.id,
          title: r.title,
          heading: r.heading,
          chunkText: r.chunk_text,
        })),
      );

  let updated = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const texts = batch.map((row) => chunkEmbedText(row));
    const vectors = await embed(texts);
    for (let j = 0; j < batch.length; j++) {
      const row = batch[j]!;
      const vec = vectors[j];
      if (!vec) continue;
      const literal = toPgVectorLiteral(vec);
      await prisma.$executeRaw`
        UPDATE legal_chunks
        SET embedding = ${literal}::vector, updated_at = NOW()
        WHERE id = ${row.id}
      `;
      updated += 1;
    }
  }

  return updated;
}

function chunkEmbedText(row: {
  title: string;
  heading: string | null;
  chunkText: string;
}): string {
  const parts = [row.title];
  if (row.heading && row.heading !== row.title) parts.push(row.heading);
  parts.push(row.chunkText);
  return parts.join("\n\n").slice(0, 8000);
}

export async function countEmbeddedChunks(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM legal_chunks WHERE embedding IS NOT NULL
  `;
  return Number(rows[0]?.count ?? 0);
}
