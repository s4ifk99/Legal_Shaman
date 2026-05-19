import "server-only";

import { prisma } from "@/lib/db/prisma";
import { embed, toPgVectorLiteral } from "@/lib/llm/client";
import { lawyerInclude, type LawyerWithRelations } from "@/lib/lawyers/db";

/**
 * Composes the canonical embedding text for a lawyer. Used by both the
 * /api/lawyers/embed admin route and the seed script so the same vectors
 * are produced regardless of entry point.
 */
export function lawyerEmbedText(l: LawyerWithRelations): string {
  const areas = l.practiceAreas.map((p) => p.practiceArea.name).join(", ");
  const langs = l.languages.map((x) => x.language.name).join(", ");
  const cities = l.locations.map((x) => x.city).filter(Boolean).join(", ");
  const parts = [
    `${l.name}.`,
    l.firm?.name ? `Firm: ${l.firm.name}.` : "",
    areas ? `Practice areas: ${areas}.` : "",
    cities ? `Based in: ${cities}.` : "",
    langs ? `Languages: ${langs}.` : "",
    l.bio,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 4000);
}

/**
 * Generate + persist embeddings for the given lawyer ids.
 * Returns the number of rows updated.
 */
export async function embedLawyers(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const lawyers = await prisma.lawyer.findMany({
    where: { id: { in: ids } },
    include: lawyerInclude,
  });
  if (lawyers.length === 0) return 0;

  const texts = lawyers.map(lawyerEmbedText);
  const vectors = await embed(texts);

  let updated = 0;
  for (let i = 0; i < lawyers.length; i++) {
    const lawyer = lawyers[i]!;
    const vec = vectors[i];
    if (!vec) continue;
    const literal = toPgVectorLiteral(vec);
    await prisma.$executeRaw`
      UPDATE lawyers
      SET embedding = ${literal}::vector,
          "updatedAt" = NOW()
      WHERE id = ${lawyer.id}
    `;
    updated++;
  }
  return updated;
}

export async function embedAllLawyers(): Promise<number> {
  const rows = await prisma.lawyer.findMany({ select: { id: true } });
  return embedLawyers(rows.map((r) => r.id));
}

/** Marker so callers can do nothing-to-do checks without round-tripping. */
export async function countLawyersMissingEmbedding(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint as count FROM lawyers WHERE embedding IS NULL
  `;
  return Number(rows[0]?.count ?? 0);
}
