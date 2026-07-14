import type { LegalSearchIntent } from "@/lib/legal-knowledge/search-intent";
import { getWikiIndex } from "@/lib/wiki/load-index";
import type { WikiPageIndex } from "@/lib/wiki/types";

import { embeddingScoresForQuery } from "./embed-match";
import { isConsumerWikiPageId, wikiAreaForTaxonomy } from "./taxonomy-map";
import type { ConceptNode } from "./types";

const TOPIC_TERMS_BY_SLUG: Record<string, string[]> = {
  employment: [
    "employment",
    "wage",
    "wages",
    "commission",
    "comission",
    "acas",
    "workplace",
    "tribunal",
    "employer",
    "redundan",
    "dismiss",
    "grievance",
  ],
  housing: ["housing", "landlord", "tenant", "deposit", "evict", "tenancy", "disrepair", "possession"],
  immigration: ["immigration", "visa", "asylum", "home office", "leave to remain"],
  family: [
    "family",
    "divorce",
    "child",
    "custody",
    "contact",
    "prenuptial",
    "prenup",
    "marriage",
    "cohabitation",
    "financial remedy",
  ],
  debt: ["debt", "bailiff", "creditor", "bankruptcy", "ccj"],
  welfare_benefits: ["benefit", "universal credit", "pip", "esa"],
  consumer_small_claims: [
    "small claim",
    "small claims",
    "county court",
    "civil claim",
    "money claim",
    "ccj",
    "court claim",
  ],
  prison_law: [
    "prison",
    "recall",
    "parole",
    "licence",
    "prisoner",
    "sentence",
    "custody",
    "hmp",
    "adjudication",
  ],
};

function pageHaystack(page: WikiPageIndex): string {
  return [
    page.title,
    page.summary,
    page.category,
    page.id,
    ...page.keyInformation,
    ...page.practicalGuidance,
  ]
    .join(" ")
    .toLowerCase();
}

/** Page-level intent guard (mirrors chunkMatchesIntent). */
export function pageMatchesIntent(page: WikiPageIndex, intent: LegalSearchIntent): boolean {
  const blob = pageHaystack(page);

  if (intent.suppressTerms.some((t) => blob.includes(t.toLowerCase()))) {
    const hasRequired = (intent.requiredTopicTerms ?? []).some((t) => blob.includes(t.toLowerCase()));
    if (!hasRequired) return false;
  }

  const required =
    intent.requiredTopicTerms?.length
      ? intent.requiredTopicTerms
      : intent.taxonomySlug
        ? TOPIC_TERMS_BY_SLUG[intent.taxonomySlug] ?? [intent.taxonomySlug.replace(/_/g, " ")]
        : [];

  if (!required.length) return true;

  const isWikiIndex =
    page.title.endsWith("— Sources") ||
    page.title.endsWith("— Key Information") ||
    page.id.endsWith("/_index");

  if (isWikiIndex && intent.taxonomySlug) {
    const onTopic = required.some((t) => blob.includes(t.toLowerCase()));
    if (!onTopic) return false;
  }

  if (intent.taxonomySlug) {
    const area = wikiAreaForTaxonomy(intent.taxonomySlug);
    if (area && page.category !== area && !blob.includes(intent.taxonomySlug.replace(/_/g, " "))) {
      const wrongArea =
        page.category === "Neighbours and Property" && intent.taxonomySlug === "employment";
      if (wrongArea) return false;
    }
  }

  return required.some((t) => blob.includes(t.toLowerCase()));
}

function scorePageForIntent(
  page: WikiPageIndex,
  intent: LegalSearchIntent,
  query: string,
  embeddingBoost = 0,
): number {
  if (!pageMatchesIntent(page, intent)) return -1;

  const blob = pageHaystack(page);
  let score = 0;
  const qLower = query.toLowerCase();

  if (intent.specificIssue && blob.includes(intent.specificIssue.toLowerCase())) score += 4;
  if (intent.taxonomySlug && blob.includes(intent.taxonomySlug.replace(/_/g, " "))) score += 2;

  const area = wikiAreaForTaxonomy(intent.taxonomySlug ?? "");
  if (area && page.category === area) score += 3;

  for (const term of intent.searchBoostTerms.slice(0, 6)) {
    if (blob.includes(term.toLowerCase())) score += 0.5;
  }

  if (intent.requiredTopicTerms?.some((t) => qLower.includes(t.toLowerCase()) && blob.includes(t.toLowerCase()))) {
    score += 2;
  }

  if (page.summary.length > 40) score += 0.5;
  if (embeddingBoost > 0) score += embeddingBoost * 4;
  return score;
}

export async function resolvePrimaryPageFromIndex(
  intent: LegalSearchIntent,
  query: string,
): Promise<WikiPageIndex | null> {
  const index = getWikiIndex();
  const candidates = index.pages.filter((p) => isConsumerWikiPageId(p.id) && !p.id.endsWith("/_index"));

  const embeddingScores = await embeddingScoresForQuery(query, {
    taxonomySlug: intent.taxonomySlug,
    limit: 16,
  });

  let best: { page: WikiPageIndex; score: number } | null = null;
  for (const page of candidates) {
    const embedBoost = embeddingScores.get(page.id) ?? 0;
    const score = scorePageForIntent(page, intent, query, embedBoost);
    if (score < 0) continue;
    if (!best || score > best.score) best = { page, score };
  }

  return best?.page ?? null;
}

export function conceptNodeFromPage(page: WikiPageIndex, dbId?: string): ConceptNode {
  return {
    id: dbId ?? page.id,
    taxonomySlug: null,
    wikiPageId: page.id,
    title: page.title,
    areaPath: page.id.split("/").slice(0, 2).join("/"),
    summaryText: page.summary,
    page,
  };
}

export function isConsumerIntent(intent: LegalSearchIntent): boolean {
  if (!intent.taxonomySlug) return false;
  return Boolean(wikiAreaForTaxonomy(intent.taxonomySlug));
}
