import "server-only";

import { reciprocalRankFusion } from "@/lib/search/rrf";
import { wikiPagePublicUrl } from "@/lib/wiki/public-url";
import type { WikiSearchHit } from "@/lib/wiki/search";

import { isEqualityServicesQuery, isUnsafeProductQuery } from "./search-intent";
import { llmRouteConfidenceMin } from "./route-llm-config";
import type { RouteDecisionMode, RouteArbitration, RouteHitSet } from "./route-types";
import type { LegalSearchSourceHit, RetrievedChunk } from "./types";

const PICK_MARGIN = 0.12;
const MIX_CLOSE = 0.18;
const MAX_SOURCES = 8;

function titleBoost(title: string, query: string, routeId: string): number {
  const t = title.toLowerCase();
  let boost = 0;

  if (isUnsafeProductQuery(query) || routeId.includes("unsafe_product")) {
    if (/reporting to trading standards/i.test(t)) boost += 0.35;
    if (/product causes damage|faulty goods|purchase/i.test(t)) boost += 0.2;
    if (/landlord|tenant|disrepair|repair/i.test(t)) boost -= 0.4;
    if (/dry cleaner|clothes/i.test(t)) boost -= 0.35;
  }

  if (isEqualityServicesQuery(query) || routeId.includes("equality")) {
    if (/goods and services|discrimination in goods/i.test(t)) boost += 0.4;
    if (/protected characteristics|equality act/i.test(t)) boost += 0.3;
    if (/taking action about discrimination/i.test(t) && !/\bat work\b/i.test(t)) {
      boost += 0.25;
    }
    if (/\bat work\b|workplace|employment tribunal|consultant solicitor/i.test(t)) {
      boost -= 0.45;
    }
  }

  if (routeId.includes("employment") || /\bunfair dismissal\b/i.test(query)) {
    if (/employment|dismiss|acas|tribunal|workplace/i.test(t)) boost += 0.25;
  }

  if (routeId.includes("cancel") || /\bcancel/i.test(query)) {
    if (/cancel/i.test(t)) boost += 0.25;
  }

  if (routeId.includes("party_wall") || /\bneighbour|extension\b/i.test(query)) {
    if (/party wall|neighbour|extension|building/i.test(t)) boost += 0.2;
  }

  return boost;
}

function scoreRouteHitSet(hitSet: RouteHitSet, userQuery: string): number {
  const { route, wikiHits, chunks, topScore } = hitSet;
  if (!wikiHits.length && !chunks.length) return 0;

  const wikiNorm = Math.min(1, topScore / 40);
  const chunkNorm = chunks[0] ? Math.min(1, chunks[0].finalScore) : 0;
  let score = Math.max(wikiNorm, chunkNorm * 0.85);

  const topTitle = wikiHits[0]?.title ?? chunks[0]?.title ?? "";
  score += titleBoost(topTitle, userQuery, route.id);

  if (route.taxonomySlug && wikiHits[0]) {
    const blob = `${wikiHits[0].title} ${wikiHits[0].summary} ${wikiHits[0].category}`.toLowerCase();
    const slugPhrase = route.taxonomySlug.replace(/_/g, " ");
    if (blob.includes(slugPhrase) || blob.includes(slugPhrase.split(" ")[0]!)) {
      score += 0.08;
    }
  }

  // Prefer pattern routes for unsafe products over primary narrative dilution.
  if (isUnsafeProductQuery(userQuery) && route.id.startsWith("pattern:")) {
    score += 0.1;
  }

  if (isEqualityServicesQuery(userQuery) && route.id.startsWith("pattern:equality")) {
    score += 0.15;
  }

  // Penalize empty-ish results
  if (wikiHits.length < 2 && chunks.length === 0) score *= 0.7;

  return Math.max(0, Math.min(1.5, score));
}

function dedupeWikiHits(hits: WikiSearchHit[]): WikiSearchHit[] {
  const byId = new Map<string, WikiSearchHit>();
  for (const h of hits) {
    const existing = byId.get(h.id);
    if (!existing || h.score > existing.score) byId.set(h.id, h);
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

function sourcesFromWiki(hits: WikiSearchHit[]): LegalSearchSourceHit[] {
  return hits.slice(0, MAX_SOURCES).map((hit, i) => ({
    title: hit.title,
    url: wikiPagePublicUrl(hit.id),
    source: "Legal Shaman Wiki",
    snippet: (hit.summary || hit.keyInformation[0] || "").slice(0, 240),
    score: Number(Math.max(0.35, 1 - i * 0.06).toFixed(4)),
    heading: hit.category || null,
  }));
}

function sourcesFromChunks(chunks: RetrievedChunk[]): LegalSearchSourceHit[] {
  return chunks.slice(0, MAX_SOURCES).map((c, i) => ({
    title: c.title,
    url: c.sourceUrl,
    source: c.sourceName,
    snippet: c.snippet.slice(0, 240),
    score: Number(Math.max(0.3, c.finalScore - i * 0.04).toFixed(4)),
    heading: c.heading,
  }));
}

function mixWikiHits(ranked: Array<{ hitSet: RouteHitSet; score: number }>): WikiSearchHit[] {
  const topTwo = ranked.slice(0, 2).map((r) => r.hitSet);
  const rankings = topTwo.map((hs) => hs.wikiHits.map((h) => h.id));
  const fusedIds = reciprocalRankFusion(rankings);
  const byId = new Map<string, WikiSearchHit>();
  for (const hs of topTwo) {
    for (const h of hs.wikiHits) byId.set(h.id, h);
  }
  const mixed = fusedIds.map((id) => byId.get(id)).filter(Boolean) as WikiSearchHit[];
  return dedupeWikiHits(mixed).slice(0, MAX_SOURCES);
}

/**
 * Score retrieved routes; pick a clear winner or mix close complementary sources.
 */
export function arbitrateSearchRoutes(args: {
  query: string;
  hitSets: RouteHitSet[];
}): RouteArbitration {
  const { query, hitSets } = args;

  const scored = hitSets
    .map((hitSet) => ({
      hitSet,
      score: scoreRouteHitSet(hitSet, query),
    }))
    .sort((a, b) => b.score - a.score);

  const routesConsidered = scored.map(({ hitSet, score }) => ({
    id: hitSet.route.id,
    label: hitSet.route.label,
    query: hitSet.route.query,
    taxonomySlug: hitSet.route.taxonomySlug,
    score: Number(score.toFixed(3)),
    topTitle: hitSet.wikiHits[0]?.title ?? hitSet.chunks[0]?.title,
  }));

  const best = scored[0];
  if (!best || best.score <= 0) {
    return {
      decision: "pick",
      chosenRouteIds: [],
      rationale: "No route returned usable hits.",
      confidence: 0.2,
      wikiHits: [],
      chunks: [],
      sources: [],
      routesConsidered,
    };
  }

  const second = scored[1];
  const margin = second ? best.score - second.score : best.score;
  const complementary =
    Boolean(second) &&
    second!.score > 0.25 &&
    margin < MIX_CLOSE &&
    best.hitSet.route.taxonomySlug !== second!.hitSet.route.taxonomySlug;

  if (complementary || (second && margin < PICK_MARGIN && second.score > 0.35)) {
    const wikiHits = mixWikiHits(scored);
    const chunks = dedupeChunks([
      ...best.hitSet.chunks,
      ...(second?.hitSet.chunks ?? []),
    ]).slice(0, MAX_SOURCES);
    const sources =
      wikiHits.length > 0 ? sourcesFromWiki(wikiHits) : sourcesFromChunks(chunks);
    const chosenRouteIds = [best.hitSet.route.id, second!.hitSet.route.id];
    return {
      decision: "mix",
      chosenRouteIds,
      rationale: `Mixed ${best.hitSet.route.label} with ${second!.hitSet.route.label} (scores ${best.score.toFixed(2)} vs ${second!.score.toFixed(2)}).`,
      confidence: Math.min(0.92, 0.5 + best.score * 0.3),
      wikiHits,
      chunks,
      sources,
      routesConsidered,
    };
  }

  const wikiHits = dedupeWikiHits(best.hitSet.wikiHits).slice(0, MAX_SOURCES);
  const chunks = best.hitSet.chunks.slice(0, MAX_SOURCES);
  const sources =
    wikiHits.length > 0 ? sourcesFromWiki(wikiHits) : sourcesFromChunks(chunks);

  return {
    decision: "pick",
    chosenRouteIds: [best.hitSet.route.id],
    rationale: `Picked ${best.hitSet.route.label} (score ${best.score.toFixed(2)}${
      second ? `, margin ${margin.toFixed(2)} over ${second.hitSet.route.label}` : ""
    }).`,
    confidence: Math.min(0.95, 0.48 + best.score * 0.35),
    wikiHits,
    chunks,
    sources,
    routesConsidered,
  };
}

function dedupeChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const byId = new Map<string, RetrievedChunk>();
  for (const c of chunks) {
    const key = c.documentId || c.id;
    const existing = byId.get(key);
    if (!existing || c.finalScore > existing.finalScore) byId.set(key, c);
  }
  return [...byId.values()].sort((a, b) => b.finalScore - a.finalScore);
}


/** Rebuild arbitration from explicit route ids (used by LLM advisor). */
export function arbitrationFromRouteIds(args: {
  hitSets: RouteHitSet[];
  chosenRouteIds: string[];
  decision: RouteDecisionMode;
  rationale: string;
  confidence: number;
  routesConsidered: RouteArbitration["routesConsidered"];
}): RouteArbitration {
  const { hitSets, chosenRouteIds, decision, rationale, confidence, routesConsidered } = args;
  const selected = chosenRouteIds
    .map((id) => hitSets.find((h) => h.route.id === id))
    .filter(Boolean) as RouteHitSet[];

  if (!selected.length) {
    return {
      decision: "pick",
      chosenRouteIds: [],
      rationale: "No matching routes for selection.",
      confidence: 0.2,
      wikiHits: [],
      chunks: [],
      sources: [],
      routesConsidered,
    };
  }

  if (decision === "mix" && selected.length >= 2) {
    const ranked = selected.map((hs) => ({ hitSet: hs, score: hs.topScore }));
    const wikiHits = mixWikiHits(ranked);
    const chunks = dedupeChunks(selected.flatMap((s) => s.chunks)).slice(0, MAX_SOURCES);
    const sources =
      wikiHits.length > 0 ? sourcesFromWiki(wikiHits) : sourcesFromChunks(chunks);
    return {
      decision: "mix",
      chosenRouteIds: selected.map((s) => s.route.id),
      rationale,
      confidence,
      wikiHits,
      chunks,
      sources,
      routesConsidered,
    };
  }

  const best = selected[0]!;
  const wikiHits = dedupeWikiHits(best.wikiHits).slice(0, MAX_SOURCES);
  const chunks = best.chunks.slice(0, MAX_SOURCES);
  const sources =
    wikiHits.length > 0 ? sourcesFromWiki(wikiHits) : sourcesFromChunks(chunks);
  return {
    decision: "pick",
    chosenRouteIds: [best.route.id],
    rationale,
    confidence,
    wikiHits,
    chunks,
    sources,
    routesConsidered,
  };
}

/**
 * When the LLM route advisor is confident, prefer its pick/mix over the rule arbiter.
 * Always keep arbiter output in training logs for comparison.
 */
export function applyLlmRouteAdvice(args: {
  arbiter: RouteArbitration;
  hitSets: RouteHitSet[];
  llmAdvice: import("./route-llm-advisor").LlmRouteAdvice | null;
}): { arbitration: RouteArbitration; decidedBy: "arbiter" | "llm" | "llm_fallback_arbiter" } {
  const { arbiter, hitSets, llmAdvice } = args;
  if (
    !llmAdvice ||
    llmAdvice.error ||
    !llmAdvice.chosenRouteIds.length ||
    llmAdvice.confidence < llmRouteConfidenceMin()
  ) {
    return { arbitration: arbiter, decidedBy: "arbiter" };
  }

  const llmArb = arbitrationFromRouteIds({
    hitSets,
    chosenRouteIds: llmAdvice.chosenRouteIds,
    decision: llmAdvice.decision,
    rationale: `LLM route advisor: ${llmAdvice.rationale}`,
    confidence: Math.min(0.95, 0.5 + llmAdvice.confidence * 0.45),
    routesConsidered: arbiter.routesConsidered,
  });

  if (!llmArb.wikiHits.length && !llmArb.chunks.length) {
    return { arbitration: arbiter, decidedBy: "llm_fallback_arbiter" };
  }

  return { arbitration: llmArb, decidedBy: "llm" };
}
