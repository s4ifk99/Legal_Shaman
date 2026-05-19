import "server-only";

import { prisma } from "@/lib/db/prisma";
import { clusterQuery, mergeClusterLabel } from "@/lib/search-quality/query-clustering";
import type { FailedSearchRow } from "@/lib/search-quality/types";

const DEFAULT_DAYS = 14;

async function eventCountsForInteractions(
  ids: string[],
): Promise<
  Map<
    string,
    { impressions: number; clicks: number; refinements: number; noResults: number }
  >
> {
  const map = new Map<
    string,
    { impressions: number; clicks: number; refinements: number; noResults: number }
  >();
  if (!ids.length) return map;
  const events = await prisma.searchEvent.findMany({
    where: { searchInteractionId: { in: ids } },
    select: {
      searchInteractionId: true,
      eventType: true,
    },
  });
  for (const e of events) {
    const id = e.searchInteractionId;
    if (!id) continue;
    const row = map.get(id) ?? { impressions: 0, clicks: 0, refinements: 0, noResults: 0 };
    if (e.eventType === "result_impression") row.impressions += 1;
    if (e.eventType === "result_click" || e.eventType === "map_marker_click") row.clicks += 1;
    if (e.eventType === "refinement_click") row.refinements += 1;
    if (e.eventType === "no_result_search") row.noResults += 1;
    map.set(id, row);
  }
  return map;
}

function parsedTaxonomyFromJson(parsed: unknown): { slug?: string; confidence?: string } {
  if (!parsed || typeof parsed !== "object") return {};
  const p = parsed as Record<string, unknown>;
  const slug =
    (typeof p.taxonomySlug === "string" && p.taxonomySlug) ||
    (typeof p.practiceAreaSlug === "string" && p.practiceAreaSlug) ||
    undefined;
  const confidence = typeof p.queryConfidence === "string" ? p.queryConfidence : undefined;
  return { slug, confidence };
}

/**
 * Pull recent searches that merit review (zero results, low engagement, low confidence).
 */
export async function loadFailedSearchReview(opts?: {
  days?: number;
  limit?: number;
}): Promise<FailedSearchRow[]> {
  const days = opts?.days ?? DEFAULT_DAYS;
  const limit = opts?.limit ?? 80;
  const since = new Date(Date.now() - days * 86400000);

  const rows = await prisma.searchInteraction.findMany({
    where: { createdAt: { gte: since }, channel: "directory" },
    orderBy: { createdAt: "desc" },
    take: limit * 2,
  });

  const ids = rows.map((r) => r.id);
  const ev = await eventCountsForInteractions(ids);

  const out: FailedSearchRow[] = [];
  for (const r of rows) {
    const parsed = parsedTaxonomyFromJson(r.parsedQuery);
    const ec = ev.get(r.id) ?? { impressions: 0, clicks: 0, refinements: 0, noResults: 0 };
    const rc = r.resultCount ?? 0;
    let failureKind: FailedSearchRow["failureKind"] = "low_clicks";
    if (rc === 0) failureKind = "zero_results";
    else if (rc < 3) failureKind = "low_results";
    if (parsed.confidence === "low") failureKind = "low_confidence";
    const dm = r.degradedModes;
    if (Array.isArray(dm) && dm.some((x) => String(x).includes("fallback"))) {
      failureKind = "external_fallback_signal";
    }
    if (ec.impressions >= 5 && ec.clicks === 0 && rc > 0) failureKind = "low_clicks";
    if (ec.refinements >= 2) failureKind = "low_clicks";

    const cq = clusterQuery(r.rawQuery);
    out.push({
      id: r.id,
      rawQuery: r.rawQuery.slice(0, 500),
      channel: r.channel,
      resultCount: r.resultCount,
      createdAt: r.createdAt.toISOString(),
      parsedTaxonomy: parsed.slug ?? null,
      queryConfidence: parsed.confidence ?? null,
      clarifyingAsked: r.clarifyingAsked,
      mapUsed: r.mapUsed,
      degradedModes: r.degradedModes,
      failureKind,
      clusterLabel: cq.normalisedKey,
      clusterHint: cq.clusterHint,
      impressionCount: ec.impressions,
      clickCount: ec.clicks,
      refinementCount: ec.refinements,
      noResultEventCount: ec.noResults,
    });
  }

  const filtered = out.filter(
    (x) =>
      x.failureKind === "zero_results" ||
      x.failureKind === "low_results" ||
      (x.impressionCount >= 3 && x.clickCount === 0) ||
      x.queryConfidence === "low" ||
      x.refinementCount >= 2 ||
      x.failureKind === "external_fallback_signal",
  );

  return filtered.slice(0, limit);
}

/** Group failed rows by cluster hint + normalised key for triage. */
export function groupFailedSearchesByCluster(rows: FailedSearchRow[]): {
  key: string;
  label: string;
  hint: string | null;
  rows: FailedSearchRow[];
}[] {
  const buckets = new Map<string, FailedSearchRow[]>();
  for (const row of rows) {
    const key = row.clusterHint ?? row.clusterLabel.slice(0, 80);
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }
  return [...buckets.entries()].map(([key, list]) => ({
    key,
    label: mergeClusterLabel(list.map((r) => r.rawQuery)),
    hint: list[0]?.clusterHint ?? null,
    rows: list,
  }));
}
