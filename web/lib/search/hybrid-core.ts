import { fetchAllListings, type Listing } from "@/lib/data";
import { postProcessHybridHits, type SearchFacets } from "@/lib/search/rerank";
import { reciprocalRankFusion } from "@/lib/search/rrf";

export type HybridHit = {
  listing: Listing;
  rrfScoreApprox: number;
  sources: ("lexical" | "semantic")[];
};

export type HybridSearchOptions = {
  limit: number;
  semantic: boolean;
  facets?: SearchFacets;
  maxPerSubcategory?: number;
  candidatePool?: number;
  /** Lexical + embedding text; defaults to user query in `hybridSearchListings`. */
  retrievalQuery?: string;
};

/**
 * Merge lexical + semantic id rankings, build raw hits, apply facets / legal rerank.
 * Safe to import from scripts (no server-only). Semantic ids are usually empty in tests.
 */
export function finalizeHybridHits(
  query: string,
  lexicalIds: string[],
  semanticIds: string[],
  options: Pick<
    HybridSearchOptions,
    "limit" | "facets" | "maxPerSubcategory" | "candidatePool"
  >,
): HybridHit[] {
  const q = query.trim();
  const {
    limit,
    facets,
    maxPerSubcategory,
    candidatePool = 220,
  } = options;
  if (!q || limit <= 0) return [];

  const rankings = semanticIds.length ? [lexicalIds, semanticIds] : [lexicalIds];
  const fused = reciprocalRankFusion(rankings, 60);

  const byId = new Map(fetchAllListings().map((l) => [l.id, l]));
  const lexSet = new Set(lexicalIds);
  const semSet = new Set(semanticIds);

  const raw: HybridHit[] = [];
  for (let i = 0; i < fused.length && raw.length < candidatePool; i++) {
    const id = fused[i]!;
    const listing = byId.get(id);
    if (!listing) continue;
    const sources: ("lexical" | "semantic")[] = [];
    if (lexSet.has(id)) sources.push("lexical");
    if (semSet.has(id)) sources.push("semantic");
    raw.push({
      listing,
      rrfScoreApprox: 1 / (1 + i),
      sources,
    });
  }

  return postProcessHybridHits(raw, q, {
    limit,
    facets,
    maxPerSubcategory,
  });
}

export type { SearchFacets } from "@/lib/search/rerank";
