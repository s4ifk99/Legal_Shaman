import "server-only";

import {
  buildExaHitsCacheKey,
  getPenumbraExaHitsCache,
  putPenumbraExaHitsCache,
} from "@/lib/penumbra/researchCache";
import { searchExaForPenumbra, type ExaSearchHit } from "@/lib/penumbra/exaSearch";
import { getWikiPageById, searchWikiPages, type WikiSearchHit } from "@/lib/wiki/search";
import { wikiPagePublicPath, wikiPageSlugFromRelativePath } from "@/lib/wiki/public-url";
import {
  dropBlockedOrUnknownExa,
  filterOpenExaByAuthority,
  isSharedWordCollisionOnly,
} from "./admit-gates";
import type { AdmitCandidate, SignpostClassification, SignpostFacet } from "./types";

const WIKI_LIMIT = 6;
const EXA_NUM = 5;
const MATTER = "signpost-loop";

function wikiExcerpt(hit: WikiSearchHit): string {
  const page = getWikiPageById(hit.id);
  const parts = [
    hit.summary,
    ...(hit.keyInformation || []).slice(0, 4),
    ...(hit.practicalGuidance || []).slice(0, 3),
    page?.content?.slice(0, 600) || "",
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function wikiUrl(hit: WikiSearchHit): string {
  const page = getWikiPageById(hit.id);
  if (page?.relativePath) {
    return wikiPagePublicPath(wikiPageSlugFromRelativePath(page.relativePath));
  }
  return wikiPagePublicPath(hit.id);
}

export function searchWikiCandidatesForFacets(
  facets: SignpostFacet[],
): AdmitCandidate[] {
  const out: AdmitCandidate[] = [];
  for (const facet of facets) {
    const hits = searchWikiPages(facet.query, WIKI_LIMIT);
    for (const hit of hits) {
      const excerpt = wikiExcerpt(hit);
      if (isSharedWordCollisionOnly(facet, { title: hit.title, excerpt })) continue;
      out.push({
        facetId: facet.id,
        urlOrId: hit.id,
        title: hit.title,
        excerpt,
        kind: "wiki",
        url: wikiUrl(hit),
      });
    }
  }
  return out;
}

function facetCachePlan(facet: SignpostFacet): string {
  return `signpost-loop|${facet.id}|${facet.scope}|${facet.query}`;
}

async function loadOrSearchExa(facet: SignpostFacet): Promise<ExaSearchHit[]> {
  const cacheKey = buildExaHitsCacheKey(facetCachePlan(facet), MATTER);
  const cached = await getPenumbraExaHitsCache(cacheKey);
  if (cached?.hits?.length) return cached.hits as ExaSearchHit[];

  const { hits } = await searchExaForPenumbra(facet.query, {
    numResults: EXA_NUM,
    scope: facet.scope,
    timeoutMs: 12_000,
  });

  let filtered = dropBlockedOrUnknownExa(hits);
  if (facet.scope === "open") {
    filtered = filterOpenExaByAuthority(filtered);
  }

  if (filtered.length) {
    await putPenumbraExaHitsCache({
      cacheKey,
      query: facetCachePlan(facet),
      matterSlug: MATTER,
      hits: filtered,
      ttlDays: facet.volatile ? 1 : undefined,
    });
  }
  return filtered;
}

export async function searchExaCandidatesForFacets(
  facets: SignpostFacet[],
  facetIdsNeedingExa: Set<string>,
): Promise<AdmitCandidate[]> {
  const targets = facets.filter((f) => facetIdsNeedingExa.has(f.id));
  // Parallel Exa — serial facet searches were a major source of multi-minute waits.
  const batches = await Promise.all(
    targets.map(async (facet) => {
      const hits = await loadOrSearchExa(facet);
      const rows: AdmitCandidate[] = [];
      for (const hit of hits) {
        const excerpt = (hit.excerpt || "").slice(0, 1000);
        if (isSharedWordCollisionOnly(facet, { title: hit.title, excerpt })) continue;
        rows.push({
          facetId: facet.id,
          urlOrId: hit.url,
          title: hit.title || hit.url,
          excerpt,
          date: hit.publishedDate,
          kind: "exa",
          url: hit.url,
        });
      }
      return rows;
    }),
  );
  return batches.flat();
}

/** One extra search for a volatile facet still lacking an official admitted page. */
export async function volatileRescueCandidates(
  classification: SignpostClassification,
  missingVolatileFacetIds: string[],
): Promise<AdmitCandidate[]> {
  const out: AdmitCandidate[] = [];
  for (const id of missingVolatileFacetIds) {
    const facet = classification.facets.find((f) => f.id === id);
    if (!facet) continue;
    const rescueQuery = [
      facet.query,
      classification.localBody || "",
      "site:gov.uk OR site:legislation.gov.uk",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 400);

    const scope = classification.localBody ? "open" : "allowlist";
    const { hits } = await searchExaForPenumbra(rescueQuery, {
      numResults: EXA_NUM,
      scope,
      timeoutMs: 12_000,
    });
    let filtered = dropBlockedOrUnknownExa(hits);
    if (scope === "open") filtered = filterOpenExaByAuthority(filtered);

    // Cache rescue hits with 1-day TTL (volatile).
    if (filtered.length) {
      const plan = `signpost-loop|rescue|${facet.id}|${facet.query}`;
      await putPenumbraExaHitsCache({
        cacheKey: buildExaHitsCacheKey(plan, MATTER),
        query: plan,
        matterSlug: MATTER,
        hits: filtered,
        ttlDays: 1,
      });
    }

    for (const hit of filtered) {
      out.push({
        facetId: facet.id,
        urlOrId: hit.url,
        title: hit.title || hit.url,
        excerpt: (hit.excerpt || "").slice(0, 1000),
        date: hit.publishedDate,
        kind: "exa",
        url: hit.url,
      });
    }
  }
  return out;
}
