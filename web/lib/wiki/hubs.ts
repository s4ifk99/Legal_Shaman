import "server-only";

import { getWikiIndex } from "./load-index";
import { listGuidesNewestFirst, latestGuideChange, type DatedWikiPage } from "./published";
import { wikiPagePublicPath } from "./public-url";
import type { WikiPageIndex } from "./types";

export const WIKI_HUB_ROOT = "Areas";

export type WikiCrumb = { label: string; href: string };

export type WikiHubChild = {
  id: string;
  title: string;
  href: string;
  guideCount: number;
  pageCount: number;
};

export type WikiHub = {
  id: string;
  title: string;
  guides: DatedWikiPage[];
  children: WikiHubChild[];
  otherPages: WikiPageIndex[];
  indexable: boolean;
  lastModified: string | null;
};

function isListable(page: WikiPageIndex): boolean {
  const leaf = page.id.split("/").pop() ?? "";
  return !page.relativePath.endsWith("_index.md") && !leaf.startsWith("_") && leaf !== "index";
}

/** Folder path segments above a page or hub id. */
export function parentFolders(id: string): string[] {
  const parts = id.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/** Breadcrumb trail for a wiki page or hub (excludes the current item). */
export function wikiBreadcrumbs(id: string): WikiCrumb[] {
  const crumbs: WikiCrumb[] = [{ label: "Ask the Shaman", href: "/ask-the-shaman" }];
  for (const folder of parentFolders(id)) {
    const leaf = folder.split("/").pop() ?? folder;
    crumbs.push({
      label: folder === WIKI_HUB_ROOT ? "Guides by area" : leaf,
      href: wikiPagePublicPath(folder),
    });
  }
  return crumbs;
}

export function hubTitle(id: string): string {
  if (id === WIKI_HUB_ROOT) return "Guides by area";
  return id.split("/").pop() ?? id;
}

/** Hub ids that contain at least one pinned who helps guide. */
export function listGuideHubIds(): string[] {
  const set = new Set<string>();
  for (const guide of listGuidesNewestFirst()) {
    for (const folder of parentFolders(guide.id)) set.add(folder);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "en-GB"));
}

const hubCache = new Map<string, WikiHub | null>();

/**
 * Folder hub for /ask-the-shaman/wiki/<folder>. Returns null when no wiki page
 * lives under that folder, so unknown paths still 404.
 */
export function getWikiHub(rawId: string): WikiHub | null {
  const id = rawId.replace(/^\/+|\/+$/g, "");
  if (!id) return null;
  if (hubCache.has(id)) return hubCache.get(id) ?? null;

  const prefix = `${id}/`;
  const depth = id.split("/").length;
  const under = getWikiIndex().pages.filter((p) => p.id.startsWith(prefix) && isListable(p));
  if (!under.length) {
    hubCache.set(id, null);
    return null;
  }

  const guides = listGuidesNewestFirst().filter((g) => g.id.startsWith(prefix));
  const guideIds = new Set(guides.map((g) => g.id));

  const childMap = new Map<string, WikiHubChild>();
  const direct: WikiPageIndex[] = [];
  for (const page of under) {
    const parts = page.id.split("/");
    if (parts.length === depth + 1) {
      if (!guideIds.has(page.id)) direct.push(page);
      continue;
    }
    const childId = parts.slice(0, depth + 1).join("/");
    const row =
      childMap.get(childId) ??
      ({
        id: childId,
        title: parts[depth] ?? childId,
        href: wikiPagePublicPath(childId),
        guideCount: 0,
        pageCount: 0,
      } satisfies WikiHubChild);
    row.pageCount += 1;
    if (guideIds.has(page.id)) row.guideCount += 1;
    childMap.set(childId, row);
  }

  const children = [...childMap.values()].sort(
    (a, b) => b.guideCount - a.guideCount || a.title.localeCompare(b.title, "en-GB"),
  );
  const otherPages = direct
    .filter((p) => p.summary.length > 40)
    .sort((a, b) => a.title.localeCompare(b.title, "en-GB"))
    .slice(0, 24);

  const hub: WikiHub = {
    id,
    title: hubTitle(id),
    guides,
    children,
    otherPages,
    indexable: guides.length > 0,
    lastModified: latestGuideChange(guides),
  };
  hubCache.set(id, hub);
  return hub;
}
