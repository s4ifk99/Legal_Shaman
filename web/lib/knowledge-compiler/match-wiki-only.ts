import { getWikiIndex } from "@/lib/wiki/load-index";

import { wikiAreaForTaxonomy } from "./taxonomy-map";
import type { ExtractedSource } from "./types";
import type { MatchedClaim } from "./match-concepts";

/** Wiki-index-only matching for eval and offline use (no Postgres). */
export function matchClaimsToWikiPages(extracted: ExtractedSource): MatchedClaim[] {
  const index = getWikiIndex();

  return extracted.claims.map((claim) => {
    const hint = `${claim.conceptHint ?? ""} ${claim.claimText}`.toLowerCase();
    const slug = claim.taxonomySlug;
    const area = slug ? wikiAreaForTaxonomy(slug) : null;

    let best: { wikiPageId: string; score: number } | null = null;
    const candidates = index.pages.filter(
      (p) => p.id.startsWith("Areas/") && (!area || p.category === area),
    );

    for (const page of candidates.slice(0, 500)) {
      let score = 0;
      const hay = `${page.title} ${page.summary}`.toLowerCase();
      if (area && page.category === area) score += 2;
      if (claim.conceptHint && hay.includes(claim.conceptHint.toLowerCase())) score += 3;
      const tokens = hint.split(/\W+/).filter((t) => t.length >= 5);
      for (const t of tokens.slice(0, 6)) {
        if (hay.includes(t)) score += 0.5;
      }
      if (!best || score > best.score) {
        best = { wikiPageId: page.id, score };
      }
    }

    return {
      ...claim,
      conceptId: best && best.score >= 2 ? best.wikiPageId : null,
      wikiPageId: best && best.score >= 2 ? best.wikiPageId : null,
      matchScore: best?.score ?? 0,
    };
  });
}
