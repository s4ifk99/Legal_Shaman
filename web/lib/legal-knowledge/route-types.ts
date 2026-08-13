import type { WikiSearchHit } from "@/lib/wiki/search";

import type { LegalSearchSourceHit, RetrievedChunk } from "./types";

export type SearchRouteMode = "satnav" | "legacy";

export type SearchRoute = {
  id: string;
  label: string;
  query: string;
  taxonomySlug?: string;
  signals: string[];
};

export type RouteHitSet = {
  route: SearchRoute;
  wikiHits: WikiSearchHit[];
  chunks: RetrievedChunk[];
  topScore: number;
  latencyMs: number;
};

export type RouteDecisionMode = "pick" | "mix";

export type RouteArbitration = {
  decision: RouteDecisionMode;
  chosenRouteIds: string[];
  rationale: string;
  confidence: number;
  wikiHits: WikiSearchHit[];
  chunks: RetrievedChunk[];
  sources: LegalSearchSourceHit[];
  routesConsidered: Array<{
    id: string;
    label: string;
    query: string;
    taxonomySlug?: string;
    score: number;
    topTitle?: string;
  }>;
};

export function searchRouteMode(): SearchRouteMode {
  const raw = process.env.SEARCH_ROUTE_MODE?.trim().toLowerCase();
  if (raw === "legacy") return "legacy";
  return "satnav";
}
