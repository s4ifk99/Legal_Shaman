import { isPcnAppealQuery, isVehicleRepairQuery } from "@/lib/legal/query-signals";
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
  dworkinKind?: "rule" | "principle" | "policy";
  dworkinSource?: "mapped" | "inferred";
};

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "so",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "to",
  "up",
  "with",
  "without",
  "about",
  "after",
  "before",
  "over",
  "under",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "it",
  "its",
  "they",
  "them",
  "their",
  "this",
  "that",
  "these",
  "those",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "not",
  "no",
  "nor",
  "too",
  "very",
  "just",
  "also",
  "than",
  "there",
  "here",
  "when",
  "where",
  "why",
  "how",
  "what",
  "which",
  "who",
  "can",
  "could",
  "should",
  "would",
  "may",
  "might",
  "must",
  "will",
  "out",
  "off",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "long",
  "short",
  "story",
  "having",
]);

const KEEP_SHORT = new Set(["uk", "cra", "mot", "ast", "lba", "ico", "uc", "pi", "jr"]);

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((t) => t.trim())
    .filter((t) => {
      if (!t || STOPWORDS.has(t)) return false;
      if (t.length >= 3) return true;
      return KEEP_SHORT.has(t);
    });
}

function scorePage(page: WikiPageIndex, terms: string[], query: string): number {
  const title = page.title.toLowerCase();
  const summary = page.summary.toLowerCase();
  const keyText = page.keyInformation.join(" ").toLowerCase();
  const guidance = page.practicalGuidance.join(" ").toLowerCase();
  const concepts = page.relatedConcepts.join(" ").toLowerCase();
  const hay = `${title} ${summary} ${page.category}`.toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += term.length >= 4 ? 12 : 8;
    if (summary.includes(term)) score += term.length >= 4 ? 4 : 2;
    if (keyText.includes(term)) score += 3;
    if (guidance.includes(term)) score += 2;
    if (concepts.includes(term)) score += 2;
  }

  if (isVehicleRepairQuery(query)) {
    if (/car repair|repairing a car|poor workmanship|poor service|faulty goods|services or traders/.test(hay)) {
      score += 90;
    }
    if (/water supply|grievance|employee monitoring|record someone|discrimination|lawyer, a solicitor/.test(hay)) {
      score -= 80;
    }
    if (/work and employment/.test((page.category || "").toLowerCase())) score -= 50;
  }

  if (isPcnAppealQuery(query)) {
    if (/appealing a parking ticket|when to appeal a parking ticket|parking tickets/.test(hay)) {
      score += 100;
    }
    if (/working hours|working time|employment law|rights at work|unsocial working/.test(hay)) {
      score -= 90;
    }
    if (/driving and parking/.test((page.category || "").toLowerCase())) score += 40;
    if (/work and employment/.test((page.category || "").toLowerCase())) score -= 60;
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
      score: scorePage(page, terms, query),
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
