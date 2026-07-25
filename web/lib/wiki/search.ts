import { getWikiIndex } from "./load-index";
import type { WikiPageIndex } from "./types";

export type WikiSearchHit = {
  id: string;
  title: string;
  category: string;
  summary: string;
  keyInformation: string[];
  practicalGuidance: string[];
  relatedConcepts: string[];
  relatedOrganisations: string[];
  score: number;
};

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scorePage(page: WikiPageIndex, terms: string[]): number {
  const title = page.title.toLowerCase();
  const summary = page.summary.toLowerCase();
  const keyText = page.keyInformation.join(" ").toLowerCase();
  const guidance = page.practicalGuidance.join(" ").toLowerCase();
  const concepts = page.relatedConcepts.join(" ").toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += term.length >= 4 ? 12 : 8;
    if (summary.includes(term)) score += term.length >= 4 ? 4 : 2;
    if (keyText.includes(term)) score += 3;
    if (guidance.includes(term)) score += 2;
    if (concepts.includes(term)) score += 2;
  }

  if (page.relativePath.endsWith("/_index.md") || page.title === "_index") {
    score *= 0.2;
  }

  // Knowledge-first: prefer Areas / Reference / Getting Help over firm Directory
  const path = page.relativePath.replace(/\\/g, "/");
  if (path.startsWith("Areas/")) score *= 1.35;
  else if (path.startsWith("Reference/Concepts/")) score *= 1.4;
  else if (path.startsWith("Reference/")) score *= 1.2;
  else if (path.startsWith("Getting Help/")) score *= 1.15;
  else if (path.startsWith("Directory/Firms/")) score *= 0.45;
  else if (path.startsWith("Directory/")) score *= 0.7;

  if (/this page moved/i.test(page.summary)) {
    score *= 0.05;
  }

  return score;
}

export function searchWikiPages(query: string, limit = 12): WikiSearchHit[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];

  const { pages } = getWikiIndex();

  return pages
    .map((page) => ({
      id: page.id,
      title: page.title,
      category: page.category,
      summary: page.summary,
      keyInformation: page.keyInformation.slice(0, 5),
      practicalGuidance: page.practicalGuidance.slice(0, 4),
      relatedConcepts: page.relatedConcepts.slice(0, 6),
      relatedOrganisations: page.relatedOrganisations.slice(0, 4),
      score: scorePage(page, terms),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getWikiPageById(id: string): WikiPageIndex | null {
  const normalized = id.replace(/^\/+/, "").replace(/\/+$/, "");
  return getWikiIndex().pages.find((p) => p.id === normalized) ?? null;
}

export function listWikiCategories(): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const page of getWikiIndex().pages) {
    if (page.relativePath.endsWith("_index.md")) continue;
    counts.set(page.category, (counts.get(page.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

export function listFeaturedWikiPages(limit = 8): WikiPageIndex[] {
  return getWikiIndex()
    .pages.filter(
      (p) =>
        !p.relativePath.endsWith("_index.md") &&
        p.summary.length > 40 &&
        p.keyInformation.length >= 2 &&
        !p.title.match(/^(Scope|SECTION|PART|PRACTICE DIRECTION|N\d)/i),
    )
    .slice(0, limit * 4)
    .sort((a, b) => b.summary.length - a.summary.length)
    .slice(0, limit);
}
