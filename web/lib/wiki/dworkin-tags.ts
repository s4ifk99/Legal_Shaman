/**
 * Map Legal Shaman wiki pages onto Dworkin tags from wiki-guides,
 * then infer rule / principle / policy for unmapped pages.
 * Used as a second sort after Taxonomy aims retrieve.
 */
import wikiGuidesRaw from "@/data/coherence/catalogues/wiki-guides.json";
import type { WikiSearchHit } from "./search";

export type DworkinKind = "rule" | "principle" | "policy";

export type DworkinTag = {
  kind: DworkinKind;
  source: "mapped" | "inferred";
  confidence: number;
};

export const DWORKIN_BOOST: Record<DworkinKind, number> = {
  rule: 18,
  principle: 12,
  policy: 6,
};

type GuideArticle = {
  title?: string;
  path?: string;
  slug?: string;
  dworkinKind?: string | null;
  dworkinConfidence?: number | null;
};

const KIND_SET = new Set<DworkinKind>(["rule", "principle", "policy"]);

function asKind(value: unknown): DworkinKind | null {
  const k = String(value || "").toLowerCase();
  return KIND_SET.has(k as DworkinKind) ? (k as DworkinKind) : null;
}

export function normalizeDworkinKey(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^Areas\//i, "")
    .replace(/\.md$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type GuideMaps = {
  byTitle: Map<string, DworkinTag>;
  byPath: Map<string, DworkinTag>;
};

let maps: GuideMaps | null = null;

function guideMaps(): GuideMaps {
  if (maps) return maps;
  const byTitle = new Map<string, DworkinTag>();
  const byPath = new Map<string, DworkinTag>();
  const articles = (wikiGuidesRaw as { articles?: GuideArticle[] }).articles || [];
  for (const article of articles) {
    const kind = asKind(article.dworkinKind);
    if (!kind) continue;
    const tag: DworkinTag = {
      kind,
      source: "mapped",
      confidence: Number(article.dworkinConfidence) || 0.8,
    };
    if (article.title) byTitle.set(normalizeDworkinKey(article.title), tag);
    if (article.slug) byTitle.set(normalizeDworkinKey(article.slug), tag);
    if (article.path) byPath.set(normalizeDworkinKey(article.path), tag);
  }
  maps = { byTitle, byPath };
  return maps;
}

export function inferDworkinKind(title: string, category = "", path = ""): DworkinKind {
  const titleLower = title.toLowerCase();
  const blob = `${title} ${category} ${path}`.toLowerCase();

  if (/reference\/concepts|\/concepts\//.test(blob) || /^concepts$/i.test(category)) {
    return "policy";
  }
  if (/\b(what is|overview|explained|topic hub|concept hub)\b/.test(titleLower)) {
    return "policy";
  }
  if (
    /\b(fair(ness)?|reasonable adjustment|equality act|human rights|natural justice|proportional)\b/.test(
      blob,
    )
  ) {
    return "principle";
  }
  if (
    /\b(appeal|appealing|check (your |if )|how to|if you|letter |complain|rights if|problem with|stop being|when to|getting repairs|section \d+)\b/.test(
      titleLower,
    )
  ) {
    return "rule";
  }
  if (
    /^areas\//i.test(path) ||
    /consumer rights|home and housing|work and employment|driving and parking|courts and disputes/i.test(
      category,
    )
  ) {
    return "rule";
  }
  return "policy";
}

export function dworkinKindForWikiPage(page: {
  title: string;
  category?: string;
  id?: string;
  relativePath?: string;
}): DworkinTag {
  const { byTitle, byPath } = guideMaps();
  const titleHit = byTitle.get(normalizeDworkinKey(page.title));
  if (titleHit) return titleHit;

  const pathKeys = [page.relativePath, page.id].filter(Boolean) as string[];
  for (const raw of pathKeys) {
    const pathHit = byPath.get(normalizeDworkinKey(raw));
    if (pathHit) return pathHit;
  }

  return {
    kind: inferDworkinKind(page.title, page.category || "", page.relativePath || page.id || ""),
    source: "inferred",
    confidence: 0.45,
  };
}

/** Second sort: prefer rule over principle over policy. Taxonomy must already have aimed the list. */
export function applyDworkinBoostToWikiHits(hits: WikiSearchHit[]): WikiSearchHit[] {
  return hits
    .map((hit) => {
      const tag = dworkinKindForWikiPage(hit);
      return {
        ...hit,
        dworkinKind: tag.kind,
        dworkinSource: tag.source,
        score: hit.score + DWORKIN_BOOST[tag.kind],
      };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
