import "server-only";

import { unifiedSearchListings } from "@/lib/search/unified-search";
import type { SearchFacets } from "@/lib/search/rerank";
import { fromUnifiedHit } from "@/lib/legal-search/adapters/listing-adapter";
import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";

/** Legal-aid heavy facet pass over the same listing index. */
export async function fetchLegalAidHits(
  query: string,
  parsed: ParsedQuery,
  limit: number,
): Promise<SearchResult[]> {
  const facets: SearchFacets = { legalAidOnly: true };
  const hits = await unifiedSearchListings(query, { limit, semantic: false, facets });
  return hits.map((h) => fromUnifiedHit(h, parsed));
}
