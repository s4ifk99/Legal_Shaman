import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getWikiIndex } from "./load-index";
import { SITEMAP_PRIORITY_WIKI_IDS, outsideEnglandAndWales } from "./sitemap-priority";
import type { WikiPageIndex } from "./types";

export type WikiPublishInfo = { publishedAt: string; updatedAt?: string };

export type DatedWikiPage = WikiPageIndex & {
  publishedAt: string | null;
  updatedAt: string | null;
};

let cachedMap: Record<string, WikiPublishInfo> | null = null;

/**
 * Publish and update dates for who helps guides.
 * Written by scripts/wiki-promote-approved.ts; backfilled from git history.
 */
export function getWikiPublishMap(): Record<string, WikiPublishInfo> {
  if (cachedMap) return cachedMap;
  const path = join(process.cwd(), "data", "wiki-published.json");
  cachedMap = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, WikiPublishInfo>)
    : {};
  return cachedMap;
}

let cachedGuides: DatedWikiPage[] | null = null;

/** Pinned England and Wales who helps guides, newest first. */
export function listGuidesNewestFirst(): DatedWikiPage[] {
  if (cachedGuides) return cachedGuides;
  const dates = getWikiPublishMap();
  const order = new Map<string, number>();
  SITEMAP_PRIORITY_WIKI_IDS.forEach((id, i) => order.set(id, i));
  const byId = new Map<string, WikiPageIndex>();
  for (const page of getWikiIndex().pages) {
    if (order.has(page.id)) byId.set(page.id, page);
  }
  const rows: DatedWikiPage[] = [];
  for (const id of SITEMAP_PRIORITY_WIKI_IDS) {
    if (outsideEnglandAndWales(id)) continue;
    const page = byId.get(id);
    if (!page) continue;
    const info = dates[id];
    rows.push({
      ...page,
      publishedAt: info?.publishedAt ?? null,
      updatedAt: info?.updatedAt ?? info?.publishedAt ?? null,
    });
  }
  rows.sort((a, b) => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    if (bt !== at) return bt - at;
    return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0);
  });
  cachedGuides = rows;
  return rows;
}

export function latestGuides(limit = 8): DatedWikiPage[] {
  return listGuidesNewestFirst().slice(0, limit);
}

/** Most recent publish or update across all guides (ISO), for hub lastmod. */
export function latestGuideChange(pages: DatedWikiPage[] = listGuidesNewestFirst()): string | null {
  let best = 0;
  for (const page of pages) {
    const t = Date.parse(page.updatedAt ?? page.publishedAt ?? "");
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best ? new Date(best).toISOString() : null;
}

export function formatGuideDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
}
