import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAllSubcategories } from "@/lib/data";
import { getWikiHub, listGuideHubIds } from "@/lib/wiki/hubs";
import { latestGuideChange, listGuidesNewestFirst } from "@/lib/wiki/published";
import { wikiPagePublicPath } from "@/lib/wiki/public-url";
import { getWikiPageById } from "@/lib/wiki/search";

export const SITE = "https://www.legalshaman.com";

/** Stable date for pages that rarely change (V3 site launch). */
const STATIC_LASTMOD = "2026-11-18T17:00:39Z";
/** Date the %2F wiki URLs started 308 redirecting to slash URLs. */
const LEGACY_REDIRECT_SINCE = "2026-11-02T14:18:18Z";
/** Remove the legacy sitemap after this date, once Google has followed the redirects. */
export const LEGACY_SITEMAP_UNTIL = "2026-12-31";

export type SitemapEntry = { loc: string; lastmod?: string | null };

export const CHILD_SITEMAPS = ["static", "latest", "guides", "hubs", "legacy"] as const;
export type ChildSitemap = (typeof CHILD_SITEMAPS)[number];

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function urlsetXml(entries: SitemapEntry[]): string {
  const rows = entries
    .map((e) => {
      const lastmod = isoDate(e.lastmod);
      return `  <url>\n    <loc>${xmlEscape(e.loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

export function sitemapIndexXml(entries: SitemapEntry[]): string {
  const rows = entries
    .map((e) => {
      const lastmod = isoDate(e.lastmod);
      return `  <sitemap>\n    <loc>${xmlEscape(e.loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </sitemap>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</sitemapindex>\n`;
}

function guideEntries(limitDays?: number): SitemapEntry[] {
  const guides = listGuidesNewestFirst();
  let rows = guides;
  if (limitDays) {
    const cutoff = Date.now() - limitDays * 86_400_000;
    rows = guides.filter((g) => g.publishedAt && Date.parse(g.publishedAt) >= cutoff);
    if (rows.length < 10) rows = guides.slice(0, 10);
  }
  return rows.map((g) => ({
    loc: `${SITE}${wikiPagePublicPath(g.id)}`,
    lastmod: g.updatedAt ?? g.publishedAt,
  }));
}

function staticEntries(): SitemapEntry[] {
  const latest = latestGuideChange() ?? STATIC_LASTMOD;
  const paths: Array<[string, string]> = [
    ["", latest],
    ["/search", STATIC_LASTMOD],
    ["/ask-the-shaman", latest],
    ["/ask-the-shaman/who-helps", latest],
    ["/blog", latest],
    ["/financing", STATIC_LASTMOD],
    ["/signposting", STATIC_LASTMOD],
    ["/for-firms", STATIC_LASTMOD],
    ["/terms", STATIC_LASTMOD],
    ["/privacy", STATIC_LASTMOD],
  ];
  const rows: SitemapEntry[] = paths.map(([p, lastmod]) => ({ loc: `${SITE}${p}`, lastmod }));
  try {
    for (const cat of getAllSubcategories()) {
      rows.push({ loc: `${SITE}/category/${cat.slug}`, lastmod: STATIC_LASTMOD });
    }
  } catch {
    /* category data optional */
  }
  return rows;
}

function hubEntries(): SitemapEntry[] {
  const rows: SitemapEntry[] = [];
  for (const id of listGuideHubIds()) {
    const hub = getWikiHub(id);
    if (!hub?.indexable) continue;
    rows.push({ loc: `${SITE}${wikiPagePublicPath(id)}`, lastmod: hub.lastModified });
  }
  return rows;
}

let legacyCache: string[] | null = null;

/**
 * Old %2F wiki URLs Google still has indexed. Listed temporarily so Google
 * recrawls them, follows the 308 and moves their signals to the slash URLs.
 */
function legacyEntries(): SitemapEntry[] {
  if (!legacyCache) {
    const path = join(process.cwd(), "data", "legacy-wiki-urls.json");
    const urls = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as string[]) : [];
    const marker = `${SITE}/ask-the-shaman/wiki/`;
    legacyCache = urls.filter((url) => {
      if (!url.startsWith(marker) || !/%2F/i.test(url)) return false;
      try {
        return Boolean(getWikiPageById(decodeURIComponent(url.slice(marker.length))));
      } catch {
        return false;
      }
    });
  }
  return legacyCache.map((loc) => ({ loc, lastmod: LEGACY_REDIRECT_SINCE }));
}

export function childSitemapEntries(name: ChildSitemap): SitemapEntry[] {
  switch (name) {
    case "static":
      return staticEntries();
    case "latest":
      return guideEntries(30);
    case "guides":
      return guideEntries();
    case "hubs":
      return hubEntries();
    case "legacy":
      return legacyEntries();
  }
}

function newest(entries: SitemapEntry[]): string | null {
  let best = 0;
  for (const e of entries) {
    const t = Date.parse(e.lastmod ?? "");
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best ? new Date(best).toISOString() : null;
}

export function sitemapIndexEntries(): SitemapEntry[] {
  const legacyActive = Date.now() <= Date.parse(`${LEGACY_SITEMAP_UNTIL}T23:59:59Z`);
  return CHILD_SITEMAPS.filter((name) => name !== "legacy" || legacyActive).map((name) => ({
    loc: `${SITE}/sitemaps/${name}.xml`,
    lastmod: newest(childSitemapEntries(name)),
  }));
}

export const XML_HEADERS = {
  "content-type": "application/xml; charset=utf-8",
  "cache-control": "public, max-age=0, must-revalidate",
};
