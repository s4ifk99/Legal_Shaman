import "server-only";

import { getWikiPageById, searchWikiPages } from "@/lib/wiki/search";
import {
  isHousingRepairQuery,
  rerankWikiHitsForQuery,
  shouldRerankWikiHits,
  stableSortWikiHits,
} from "@/lib/wiki/rerank-hits";
import type { WikiPageIndex } from "@/lib/wiki/types";

import { hybridLegalRetrieval } from "./retrieval";
import type { LegalSearchIntent } from "./search-intent";
import type { RouteHitSet, SearchRoute } from "./route-types";
import type { RetrievedChunk } from "./types";

function isQuarantinedPage(page: WikiPageIndex): boolean {
  const path = page.relativePath.toLowerCase();
  return path.includes("_quarantine") || path.includes("/firms/_quarantine/");
}

function routeTimeoutMs(): number {
  return Number(
    process.env.SEARCH_ROUTE_TIMEOUT_MS ?? (process.env.VERCEL === "1" ? 6_000 : 10_000),
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
}

function wikiHitsForRoute(routeQuery: string, userQuery: string) {
  let hits = searchWikiPages(routeQuery, 12).filter((hit) => {
    const page = getWikiPageById(hit.id);
    return page ? !isQuarantinedPage(page) : true;
  });

  if (isHousingRepairQuery(userQuery) || shouldRerankWikiHits(userQuery)) {
    hits = rerankWikiHitsForQuery(userQuery, hits);
  } else if (shouldRerankWikiHits(routeQuery)) {
    hits = rerankWikiHitsForQuery(routeQuery, hits);
  }

  return stableSortWikiHits(hits).slice(0, 8);
}

async function lexicalChunksForRoute(
  route: SearchRoute,
  intent: LegalSearchIntent,
): Promise<RetrievedChunk[]> {
  // Lexical DB fan-out is optional — enable with SEARCH_ROUTE_LEXICAL=1 (off by default).
  if (process.env.SEARCH_ROUTE_LEXICAL !== "1" && process.env.SEARCH_ROUTE_LEXICAL !== "true") {
    return [];
  }
  if (process.env.VERCEL === "1") return [];

  const routeIntent: LegalSearchIntent = {
    ...intent,
    taxonomySlug: route.taxonomySlug ?? intent.taxonomySlug,
    semanticQuery: route.query,
    retrievalQueries: [route.query],
  };

  try {
    const { chunks } = await hybridLegalRetrieval(route.query, {
      limit: 24,
      intent: routeIntent,
    });
    return chunks.slice(0, 8);
  } catch {
    return [];
  }
}

async function retrieveOneRoute(
  route: SearchRoute,
  userQuery: string,
  intent: LegalSearchIntent,
): Promise<RouteHitSet> {
  const t0 = Date.now();
  const wikiHits = wikiHitsForRoute(route.query, userQuery);
  const chunks = await lexicalChunksForRoute(route, intent);
  const topScore = Math.max(
    wikiHits[0]?.score ?? 0,
    ...(chunks.slice(0, 1).map((c) => c.finalScore * 80)),
  );

  return {
    route,
    wikiHits,
    chunks,
    topScore,
    latencyMs: Date.now() - t0,
  };
}

/** Parallel cheap retrieval for each planned route (wiki-first; optional lexical off-Vercel). */
export async function retrieveSearchRoutes(args: {
  routes: SearchRoute[];
  query: string;
  intent: LegalSearchIntent;
}): Promise<RouteHitSet[]> {
  const { routes, query, intent } = args;
  const timeout = routeTimeoutMs();
  const empty = (route: SearchRoute): RouteHitSet => ({
    route,
    wikiHits: [],
    chunks: [],
    topScore: 0,
    latencyMs: 0,
  });

  return Promise.all(
    routes.map((route) =>
      withTimeout(retrieveOneRoute(route, query, intent), timeout, empty(route)),
    ),
  );
}
