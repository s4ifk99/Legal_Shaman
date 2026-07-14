import "server-only";

import { prisma } from "@/lib/db/prisma";

export type ClassificationGapRow = {
  id: string;
  rawQuery: string;
  createdAt: string;
  fusionSource?: string;
  ruleTaxonomySlug?: string;
  ruleMatchStrength?: number;
  llmTaxonomySlug?: string;
  llmConfidence?: number;
  taxonomySlug?: string;
  specificIssue?: string;
  phraseCandidates?: string[];
};

function parseParsedQuery(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  return json as Record<string, unknown>;
}

/** Recent legal-knowledge searches where LLM fusion differed from rules or filled a gap. */
export async function loadClassificationGaps(limit = 80): Promise<ClassificationGapRow[]> {
  const rows = await prisma.searchInteraction.findMany({
    where: { channel: "legal_knowledge" },
    orderBy: { createdAt: "desc" },
    take: limit * 4,
    select: {
      id: true,
      rawQuery: true,
      createdAt: true,
      parsedQuery: true,
    },
  });

  const gaps: ClassificationGapRow[] = [];

  for (const row of rows) {
    const pq = parseParsedQuery(row.parsedQuery);
    if (!pq) continue;

    const fusionSource = pq.fusionSource as string | undefined;
    const ruleSlug = pq.ruleTaxonomySlug as string | undefined;
    const llmSlug = pq.llmTaxonomySlug as string | undefined;
    const disagree = ruleSlug && llmSlug && ruleSlug !== llmSlug;
    const llmFilled = fusionSource === "llm";

    if (!llmFilled && !disagree) continue;

    gaps.push({
      id: row.id,
      rawQuery: row.rawQuery,
      createdAt: row.createdAt.toISOString(),
      fusionSource,
      ruleTaxonomySlug: ruleSlug,
      ruleMatchStrength: pq.ruleMatchStrength as number | undefined,
      llmTaxonomySlug: llmSlug,
      llmConfidence: pq.llmConfidence as number | undefined,
      taxonomySlug: pq.taxonomySlug as string | undefined,
      specificIssue: pq.specificIssue as string | undefined,
      phraseCandidates: pq.phraseCandidates as string[] | undefined,
    });

    if (gaps.length >= limit) break;
  }

  return gaps;
}

/** Group gap rows by LLM taxonomy for taxonomy backlog review. */
export function groupClassificationGapsByTaxonomy(
  rows: ClassificationGapRow[],
): Array<{ taxonomySlug: string; count: number; examples: string[] }> {
  const map = new Map<string, { count: number; examples: string[] }>();
  for (const row of rows) {
    const slug = row.llmTaxonomySlug ?? row.taxonomySlug ?? "unknown";
    const entry = map.get(slug) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 5) entry.examples.push(row.rawQuery);
    map.set(slug, entry);
  }
  return [...map.entries()]
    .map(([taxonomySlug, v]) => ({ taxonomySlug, ...v }))
    .sort((a, b) => b.count - a.count);
}
