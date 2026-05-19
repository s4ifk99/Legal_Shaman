import "server-only";

import { prisma } from "@/lib/db/prisma";
import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";

const DEFAULT_DAYS = 30;

export type TaxonomyGapReport = {
  lowConfidenceQueries: { query: string; count: number; sampleInteractionId: string }[];
  unclassifiedHighVolume: { query: string; count: number }[];
  clarifyHeavy: { query: string; count: number }[];
  taxonomySlugHistogram: { slug: string; count: number }[];
  /** Aliases from taxonomy data not seen in recent query prefixes (informational). */
  unusedAliasExamples: string[];
};

function slugFromParsed(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  const s =
    (typeof p.taxonomySlug === "string" && p.taxonomySlug) ||
    (typeof p.practiceAreaSlug === "string" && p.practiceAreaSlug);
  return s || null;
}

function confidenceFromParsed(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  return typeof p.queryConfidence === "string" ? p.queryConfidence : null;
}

export async function analyzeTaxonomyGaps(opts?: { days?: number }): Promise<TaxonomyGapReport> {
  const since = new Date(Date.now() - (opts?.days ?? DEFAULT_DAYS) * 86400000);
  const interactions = await prisma.searchInteraction.findMany({
    where: { createdAt: { gte: since }, channel: "directory" },
    select: { id: true, rawQuery: true, parsedQuery: true, clarifyingAsked: true },
    take: 5000,
  });

  const slugHist = new Map<string, number>();
  const lowConf = new Map<string, { count: number; sampleId: string }>();
  const noSlug = new Map<string, number>();
  const clarify = new Map<string, number>();

  for (const row of interactions) {
    const slug = slugFromParsed(row.parsedQuery);
    const conf = confidenceFromParsed(row.parsedQuery);
    const q = row.rawQuery.trim().toLowerCase().slice(0, 120);
    if (slug) slugHist.set(slug, (slugHist.get(slug) ?? 0) + 1);
    else {
      noSlug.set(q, (noSlug.get(q) ?? 0) + 1);
    }
    if (conf === "low") {
      const cur = lowConf.get(q) ?? { count: 0, sampleId: row.id };
      lowConf.set(q, { count: cur.count + 1, sampleId: cur.sampleId || row.id });
    }
    if (row.clarifyingAsked) {
      clarify.set(q, (clarify.get(q) ?? 0) + 1);
    }
  }

  const taxonomySlugHistogram = [...slugHist.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 24);

  const lowConfidenceQueries = [...lowConf.entries()]
    .map(([query, v]) => ({
      query,
      count: v.count,
      sampleInteractionId: v.sampleId,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  const unclassifiedHighVolume = [...noSlug.entries()]
    .map(([query, count]) => ({ query, count }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  const clarifyHeavy = [...clarify.entries()]
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const aliasSet = new Set(LEGAL_ISSUE_TAXONOMY.flatMap((e) => e.aliases.map((a) => a.toLowerCase())));
  const unusedAliasExamples = [...aliasSet].filter((a) => a.length > 6).slice(0, 20);

  return {
    lowConfidenceQueries,
    unclassifiedHighVolume,
    clarifyHeavy,
    taxonomySlugHistogram,
    unusedAliasExamples,
  };
}
