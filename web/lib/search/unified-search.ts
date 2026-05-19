import "server-only";

import type { HybridHit } from "@/lib/search/hybrid-core";
import { hybridSearchListings } from "@/lib/search/hybrid";
import { reciprocalRankFusion } from "@/lib/search/rrf";
import type { SearchFacets } from "@/lib/search/rerank";
import {
  buildFusedSearchTokens,
  hybridHitsFromGroupToken,
} from "@/lib/search/group-adl-hits";

const ADL_PREFIX = "adl:";

export type UnifiedSearchHit =
  | { kind: "adl"; hit: HybridHit }
  | {
      kind: "adlGroup";
      firmGroupId: string;
      representative: HybridHit;
      hits: HybridHit[];
    };

export type UnifiedSearchOptions = {
  limit: number;
  semantic: boolean;
  facets?: SearchFacets;
  maxPerSubcategory?: number;
  candidatePool?: number;
  /** Passed to hybrid search for lexical + embeddings (defaults to `userQuery`). */
  retrievalQuery?: string;
};

/**
 * Directory search: hybrid lexical (+ optional Typesense) + semantic over merged listings,
 * with legal-aid multi-office grouping via RRF token walk.
 */
export async function unifiedSearchListings(
  query: string,
  options: UnifiedSearchOptions,
): Promise<UnifiedSearchHit[]> {
  const q = query.trim();
  const { limit, semantic, facets, maxPerSubcategory, candidatePool, retrievalQuery } = options;
  if (!q || limit <= 0) return [];

  const adlLimit = Math.min(120, Math.max(limit * 3, 60));
  const adlHits = await hybridSearchListings(q, {
    limit: adlLimit,
    semantic,
    facets,
    maxPerSubcategory,
    candidatePool,
    retrievalQuery,
  });

  const adlKeys = adlHits.map((h) => `${ADL_PREFIX}${h.listing.id}`);
  const adlMap = new Map(adlHits.map((h) => [`${ADL_PREFIX}${h.listing.id}`, h]));

  const fused = reciprocalRankFusion([adlKeys], 60);
  const tokens = buildFusedSearchTokens(fused, ADL_PREFIX, adlMap);

  const out: UnifiedSearchHit[] = [];

  for (const t of tokens) {
    if (out.length >= limit) break;
    if (t.type === "adl") {
      out.push({ kind: "adl", hit: t.hit });
      continue;
    }
    if (t.type === "adlGroup") {
      const hits = hybridHitsFromGroupToken(t);
      if (hits.length === 0) continue;
      out.push({
        kind: "adlGroup",
        firmGroupId: t.gid,
        representative: hits[0]!,
        hits,
      });
    }
  }

  return out;
}
