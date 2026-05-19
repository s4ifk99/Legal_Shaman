import "server-only";

import type { Listing } from "@/lib/data";
import { fetchAllListings } from "@/lib/data";
import { buildExpandedSearchText, resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { enableTypesense, enableTypesenseUnified } from "@/lib/legal-search/config";
import { searchLegalEntitiesMulti } from "@/lib/search-index/typesense-legal-entities-search";
import { lexicalSearchListingsInSubset } from "@/lib/search/lexical";
import {
  searchListingsTypesense,
  typesenseListingsConfigured,
} from "@/lib/search/typesense-listings";

function escapeFilterValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

/** Category page search: prefer `legal_entities`, fall back to legacy listings index. */
export async function searchListingsInCategory(
  slug: string,
  filterQ: string,
  pool: Listing[],
): Promise<Listing[]> {
  if (filterQ.length < 2) return pool;

  const res = resolveLegalIssueFromQuery(filterQ);
  const expandedQ = buildExpandedSearchText(res, filterQ);

  if (enableTypesenseUnified()) {
    const subFilter = `categories:=\`${escapeFilterValue(slug)}\``;
    const { hits } = await searchLegalEntitiesMulti({
      q: filterQ,
      expandedQ,
      limit: 400,
      filterBy: subFilter,
    });
    if (hits.length) {
      const byId = new Map(fetchAllListings().map((l) => [l.id, l]));
      const out: Listing[] = [];
      for (const h of hits) {
        const docId = String(h.document.id ?? "");
        const rawId = docId.includes(":") ? docId.split(":").pop()! : docId;
        const listing = byId.get(rawId);
        if (listing && listing.subcategory === slug) out.push(listing);
      }
      if (out.length) return out;
    }
  }

  if (enableTypesense() && typesenseListingsConfigured()) {
    const hits = await searchListingsTypesense(expandedQ, 400, undefined, {
      subcategorySlug: slug,
    });
    if (hits.length) return hits.map((h) => h.listing);
  }

  const hits = lexicalSearchListingsInSubset(expandedQ, pool, 400);
  if (hits.length) return hits.map((h) => h.listing);
  return pool;
}
