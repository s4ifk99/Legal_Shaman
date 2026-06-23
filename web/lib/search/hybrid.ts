import "server-only";

import { loadEmbeddingsBundle, semanticTopIds } from "@/lib/embeddings-store";
import { embedQueryWithHf } from "@/lib/embed-query";
import { lexicalSearchListings } from "@/lib/search/lexical";
import {
  searchListingsTypesense,
  typesenseListingsConfigured,
  typesenseListingsReachable,
} from "@/lib/search/typesense-listings";
import {
  finalizeHybridHits,
  type HybridHit,
  type HybridSearchOptions,
} from "@/lib/search/hybrid-core";
import { enableTypesense, enableVectorSearch, usePostgresDirectorySearch } from "@/lib/legal-search/config";

export type { HybridHit, HybridSearchOptions, SearchFacets } from "@/lib/search/hybrid-core";

export async function hybridSearchListings(
  userQuery: string,
  options: HybridSearchOptions & { retrievalQuery?: string },
): Promise<HybridHit[]> {
  const qUser = userQuery.trim();
  const rq = (options.retrievalQuery ?? userQuery).trim();
  const {
    limit,
    semantic,
    facets,
    maxPerSubcategory,
    candidatePool = 220,
  } = options;
  if (!qUser || !rq || limit <= 0) return [];

  let lexicalHits;
  const useTypesenseLexical =
    !usePostgresDirectorySearch() &&
    enableTypesense() &&
    typesenseListingsConfigured() &&
    (await typesenseListingsReachable());
  if (useTypesenseLexical) {
    lexicalHits = await searchListingsTypesense(rq, 120, facets);
  } else {
    lexicalHits = lexicalSearchListings(rq, 120);
  }
  const lexicalIds = lexicalHits.map((h) => h.listing.id);

  let semanticIds: string[] = [];
  if (semantic && enableVectorSearch()) {
    const bundle = loadEmbeddingsBundle();
    if (bundle) {
      const qVec = await embedQueryWithHf(rq, bundle.modelId, bundle.dim);
      if (qVec) semanticIds = semanticTopIds(qVec, bundle, 80);
    }
  }

  return finalizeHybridHits(qUser, lexicalIds, semanticIds, {
    limit,
    facets,
    maxPerSubcategory,
    candidatePool,
  });
}

export async function rankedListingIdsForQuery(
  query: string,
  options: { limit: number; semantic: boolean },
): Promise<string[]> {
  const hits = await hybridSearchListings(query, options);
  return hits.map((h) => h.listing.id);
}
