import { prisma } from "@/lib/db/prisma";
import { embed, embedConfigured, toPgVectorLiteral } from "@/lib/llm/client";

const BATCH = 32;

export async function embedConceptSummaries(limit = 500): Promise<number> {
  if (!embedConfigured()) {
    console.warn("[knowledge-compiler.embed] embeddings not configured");
    return 0;
  }

  const rows = await prisma.knowledgeConcept.findMany({
    where: { summaryText: { not: null } },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const texts = batch.map((r) => `${r.title}\n${r.summaryText ?? ""}`.slice(0, 2000));
    const vectors = await embed(texts);
    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j];
      if (!vec) continue;
      const literal = toPgVectorLiteral(vec);
      await prisma.$executeRaw`
        UPDATE knowledge_concepts
        SET embedding = ${literal}::vector, updated_at = NOW()
        WHERE id = ${batch[j]!.id}
      `;
      updated += 1;
    }
  }
  return updated;
}
