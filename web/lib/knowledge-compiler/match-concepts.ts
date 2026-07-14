import { prisma } from "@/lib/db/prisma";
import { getWikiIndex } from "@/lib/wiki/load-index";

import { embeddingScoresForQuery } from "./embed-match";
import { wikiAreaForTaxonomy } from "./taxonomy-map";
import type { ExtractedSource } from "./types";

export type MatchedClaim = ExtractedSource["claims"][number] & {
  conceptId: string | null;
  wikiPageId: string | null;
  matchScore: number;
};

export async function matchClaimsToConcepts(
  extracted: ExtractedSource,
): Promise<MatchedClaim[]> {
  const index = getWikiIndex();
  let dbConcepts: Array<{
    id: string;
    wikiPageId: string;
    title: string;
    taxonomySlug: string | null;
    summaryText: string | null;
  }> = [];
  try {
    dbConcepts = await prisma.knowledgeConcept.findMany({ take: 5000 });
  } catch {
    dbConcepts = [];
  }

  const embeddingByPage = new Map<string, number>();
  for (const claim of extracted.claims) {
    const hint = `${claim.conceptHint ?? ""} ${claim.claimText}`;
    const scores = await embeddingScoresForQuery(hint, {
      taxonomySlug: claim.taxonomySlug,
      limit: 6,
    });
    for (const [pageId, score] of scores) {
      embeddingByPage.set(pageId, Math.max(embeddingByPage.get(pageId) ?? 0, score));
    }
  }

  return extracted.claims.map((claim) => {
    const hint = `${claim.conceptHint ?? ""} ${claim.claimText}`.toLowerCase();
    const slug = claim.taxonomySlug;

    let best: { conceptId: string; wikiPageId: string; score: number } | null = null;

    for (const row of dbConcepts) {
      let score = 0;
      const page = index.pages.find((p) => p.id === row.wikiPageId);
      const hay = `${row.title} ${row.summaryText ?? ""} ${page?.summary ?? ""}`.toLowerCase();

      if (slug && row.taxonomySlug === slug) score += 3;
      if (slug && wikiAreaForTaxonomy(slug) === page?.category) score += 2;
      if (claim.conceptHint && hay.includes(claim.conceptHint.toLowerCase())) score += 3;

      const tokens = hint.split(/\W+/).filter((t) => t.length >= 5);
      for (const t of tokens.slice(0, 6)) {
        if (hay.includes(t)) score += 0.5;
      }

      const embedScore = embeddingByPage.get(row.wikiPageId) ?? 0;
      if (embedScore > 0) score += embedScore * 3;

      if (!best || score > best.score) {
        best = { conceptId: row.id, wikiPageId: row.wikiPageId, score };
      }
    }

    if (!best || best.score < 2) {
      const area = slug ? wikiAreaForTaxonomy(slug) : null;
      const candidates = index.pages.filter(
        (p) => p.id.startsWith("Areas/") && (!area || p.category === area),
      );
      for (const page of candidates.slice(0, 400)) {
        let score = 0;
        const hay = `${page.title} ${page.summary}`.toLowerCase();
        if (slug && wikiAreaForTaxonomy(slug) === page.category) score += 2;
        if (claim.conceptHint && hay.includes(claim.conceptHint.toLowerCase())) score += 2;
        const tokens = hint.split(/\W+/).filter((t) => t.length >= 5);
        for (const t of tokens.slice(0, 6)) {
          if (hay.includes(t)) score += 0.5;
        }
        const embedScore = embeddingByPage.get(page.id) ?? 0;
        if (embedScore > 0) score += embedScore * 3;

        if (!best || score > best.score) {
          best = { conceptId: page.id, wikiPageId: page.id, score };
        }
      }
    }

    return {
      ...claim,
      conceptId: best && best.score >= 2 ? best.conceptId : null,
      wikiPageId: best && best.score >= 2 ? best.wikiPageId : null,
      matchScore: best?.score ?? 0,
    };
  });
}
