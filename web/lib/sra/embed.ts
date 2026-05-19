import { prisma } from "@/lib/db/prisma";
import { embed, toPgVectorLiteral } from "@/lib/llm/client";

/**
 * SRA organisation embedding helper.
 *
 * Composes a stable embedding text per SRA org and writes the vector into
 * `sra_organisations.embedding` via $executeRaw. Used by:
 *   - `scripts/sync-sra-meili.ts` (per-chunk, during pulls)
 *   - `scripts/embed-sra-orgs.ts` (`npm run sra:embed`, backfill)
 *   - the lawyer matcher's hybrid retrieval (consumes the column)
 */

type EmbedRow = {
  id: string;
  business_name: string;
  search_text: string;
  city: string;
  postcode: string;
  county: string;
  country: string;
};

/** Composes the canonical embedding text for an SRA organisation row. */
export function sraOrgEmbedText(row: EmbedRow): string {
  const parts: string[] = [];
  parts.push(`${row.business_name}.`);
  const loc = [row.city, row.county, row.postcode, row.country].filter((s) => s && s.trim());
  if (loc.length) parts.push(`Based in: ${loc.join(", ")}.`);
  if (row.search_text) parts.push(row.search_text);
  return parts.join(" ").slice(0, 4000);
}

const EMBED_BATCH = 64;

/** Embed a fixed set of SRA org ids. Returns rows updated. */
export async function embedSraOrgsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < ids.length; i += EMBED_BATCH) {
    const slice = ids.slice(i, i + EMBED_BATCH);
    const rows = await prisma.$queryRaw<EmbedRow[]>`
      SELECT id, business_name, search_text, city, postcode, county, country
      FROM sra_organisations
      WHERE id = ANY (${slice}::text[])
    `;
    if (rows.length === 0) continue;
    const texts = rows.map(sraOrgEmbedText);
    const vectors = await embed(texts);
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j]!;
      const vec = vectors[j];
      if (!vec) continue;
      const literal = toPgVectorLiteral(vec);
      await prisma.$executeRaw`
        UPDATE sra_organisations
        SET embedding = ${literal}::vector,
            updated_at = NOW()
        WHERE id = ${row.id}
      `;
      updated++;
    }
  }
  return updated;
}

/** Backfill embeddings only for rows where `embedding IS NULL`. */
export async function embedSraOrgsMissing(limit = 1000): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM sra_organisations WHERE embedding IS NULL LIMIT ${limit}
  `;
  if (rows.length === 0) return 0;
  return embedSraOrgsByIds(rows.map((r) => r.id));
}

/** Re-embed every row (use sparingly — paginates by 1000). */
export async function embedAllSraOrgs(): Promise<number> {
  let total = 0;
  let cursor: string | null = null;
  for (;;) {
    const rows: { id: string }[] = cursor
      ? await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM sra_organisations
          WHERE id > ${cursor}
          ORDER BY id ASC
          LIMIT 1000
        `
      : await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM sra_organisations
          ORDER BY id ASC
          LIMIT 1000
        `;
    if (rows.length === 0) break;
    total += await embedSraOrgsByIds(rows.map((r) => r.id));
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < 1000) break;
  }
  return total;
}

export async function countSraOrgsMissingEmbedding(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM sra_organisations WHERE embedding IS NULL
  `;
  return Number(rows[0]?.count ?? 0);
}
