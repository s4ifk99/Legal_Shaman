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
  immigration: ["immigration", "visa", "asylum", "home office", "leave to remain", "indefinite leave"],
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
    "domestic abuse",
    "domestic violence",
    "co-parent",
    "coparent",
    "contact order",
    "non-molestation",
    "child arrangements",
  ],
  debt: ["debt", "bailiff", "creditor", "bankruptcy", "ccj"],
  welfare_benefits: ["benefit", "universal credit", "pip", "esa"],
  consumer: ["consumer", "customs", "import", "excise", "hmrc", "refund", "faulty", "trader"],
  consumer_services: [
    "consumer",
    "service",
    "trader",
    "tradesman",
    "builder",
    "cancel",
    "cancellation",
    "booking",
    "deposit",
    "workmanship",
    "contractor",
  ],
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
  conveyancing: [
    "conveyancing",
    "conveyancer",
    "property purchase",
    "buying",
    "house purchase",
    "first time buyer",
    "first-time buyer",
    "ftb",
    "remortgage",
    "leasehold",
    "transfer of equity",
    "solicitor",
  ],
};

const FAMILY_QUERY_SIGNALS =
  /\b(co-?parent|domestic abuse|domestic violence|abusive ex|abusive partner|non-?molestation|contact order|child arrangements|custody|cafcass)\b/i;

const CUSTOMS_QUERY_SIGNALS =
  /\b(customs|import duty|import tax|excise|hmrc|bringing .+ into (the )?(uk|england|scotland|wales)|fly(ing)? from .+ with|bringing .+ from abroad)\b/i;

/** Meaningful query tokens for page–query overlap (length ≥ 4, drop stopwords). */
export function queryContentTokens(query: string): string[] {
  const stop = new Set([
    "that",
    "this",
    "with",
    "from",
    "have",
    "been",
    "will",
    "would",
    "about",
    "into",
    "they",
    "them",
    "then",
    "than",
    "what",
    "when",
    "where",
    "which",
    "there",
    "their",
    "should",
    "could",
    "need",
    "help",
    "want",
    "just",
    "like",
    "some",
    "also",
    "very",
    "england",
    "scotland",
    "wales",
    "london",
  ]);
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 4 && !stop.has(t));
}

export function queryPageTokenOverlap(query: string, page: WikiPageIndex): number {
  const tokens = queryContentTokens(query);
  if (!tokens.length) return 0;
  const blob = pageHaystack(page);
  let hits = 0;
  for (const t of tokens) {
    if (blob.includes(t)) hits += 1;
  }
  return hits / tokens.length;
}

/**
 * Long user narratives dilute token overlap (tiles, Sunday, travel…). Prefer
 * intent semantic/specific/boost terms when the raw query is long.
 */
export function topicalQueryForOverlap(intent: LegalSearchIntent, query: string): string {
  const parts = [
    intent.canonicalName,
    intent.specificIssue,
    ...intent.searchBoostTerms.slice(0, 10),
  ].filter((p): p is string => Boolean(p?.trim()));

  // Prefer short intent labels; avoid stuffing the full narrative into overlap.
  if (query.length >= 280 || parts.length >= 2) {
    const condensed = [...new Set(parts.map((p) => p.trim()))].join(" ").trim();
    if (condensed.length >= 12) return condensed;
  }
  if (query.length < 320) return query;
  return intent.semanticQuery?.slice(0, 160) || query.slice(0, 320);
}

/**
 * Area/category hub pages (e.g. "Family Law") — too broad when the user named a
 * specific issue like prenup or conveyancing.
 */
export function isCategoryHubPage(page: WikiPageIndex): boolean {
  const parts = page.id.split("/").filter(Boolean);
  // Areas/<Category> or Areas/<Category>/_index style hubs
  if (parts.length <= 2) return true;
  if (page.id.endsWith("/_index")) return true;
  if (/^Topic hub for\b/i.test(page.summary?.trim() ?? "")) return true;
  const titleNorm = page.title.trim().toLowerCase();
  const catNorm = page.category.trim().toLowerCase();
  if (titleNorm && catNorm && (titleNorm === catNorm || titleNorm === `${catNorm} law`)) {
    return true;
  }
  // Titles that are just the area name without a specific topic
  if (
    /^(family( and relationships)?|home and housing|employment|immigration( and citizenship)?|consumer rights|debt|welfare|home improvements|litigation)(\s+law)?$/i.test(
      page.title.trim(),
    )
  ) {
    return true;
  }
  return false;
}

/** Extra topical tokens from specificIssue / boost terms for related-page filtering. */
export function intentTopicTokens(intent: LegalSearchIntent, query: string): string[] {
  const tokens = new Set<string>();
  for (const t of queryContentTokens(query)) tokens.add(t);
  if (intent.specificIssue) {
    for (const t of queryContentTokens(intent.specificIssue)) tokens.add(t);
  }
  for (const t of intent.searchBoostTerms.slice(0, 8)) {
    const n = t.toLowerCase().trim();
    if (n.length >= 4) tokens.add(n);
  }
  return [...tokens];
}

/** Reject related pages that share the area but not the user's topical terms. */
export function pageMatchesQueryTopic(
  page: WikiPageIndex,
  intent: LegalSearchIntent,
  query: string,
  minOverlap = 0.15,
): boolean {
  if (!pageMatchesIntent(page, intent)) return false;
  if (isCategoryHubPage(page) && intent.specificIssue) return false;

  const overlap = queryPageTokenOverlap(topicalQueryForOverlap(intent, query), page);
  if (overlap >= minOverlap) return true;

  const blob = pageHaystack(page);
  const topicTokens = intentTopicTokens(intent, topicalQueryForOverlap(intent, query));
  if (!topicTokens.length) return overlap >= 0.1;
  const hits = topicTokens.filter((t) => blob.includes(t)).length;
  return hits / topicTokens.length >= minOverlap;
}

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

  // Family intent must not land on housing/landlord pages.
  if (
    intent.taxonomySlug === "family" &&
    (page.category === "Home and Housing" ||
      /\b(landlord|tenant|tenancy|section 21|deposit)\b/i.test(blob))
  ) {
    return false;
  }

  // Immigration intent must not land on customs/import consumer guides, and vice versa.
  if (
    intent.taxonomySlug === "immigration" &&
    /\b(customs|import duty|excise|hmrc border)\b/i.test(blob) &&
    !/\b(visa|asylum|leave to remain|home office)\b/i.test(blob)
  ) {
    return false;
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

  const overlapQuery = topicalQueryForOverlap(intent, query);
  const overlap = queryPageTokenOverlap(overlapQuery, page);
  // Require real query↔page token overlap — taxonomy alone is not enough.
  const minOverlap = intent.specificIssue ? 0.18 : 0.12;
  if (overlap < minOverlap) return -1;

  // Prefer specific issue pages over category hubs when the user named an issue.
  if (intent.specificIssue && isCategoryHubPage(page)) return -1;

  const blob = pageHaystack(page);
  let score = 0;
  const qLower = query.toLowerCase();

  // Prenup / marriage agreement queries must not land on child/visa hubs.
  if (/\b(prenup|prenuptial|pre-nup)\b/i.test(qLower + " " + (intent.specificIssue ?? ""))) {
    if (/\b(sponsor|skilled worker|visa|child arrangements|custody|cafcass)\b/i.test(blob)) {
      if (!/\b(prenup|prenuptial|pre-nup|marriage contract|nuptial)\b/i.test(blob)) return -1;
    }
  }

  if (intent.specificIssue && blob.includes(intent.specificIssue.toLowerCase())) score += 4;
  if (intent.taxonomySlug && blob.includes(intent.taxonomySlug.replace(/_/g, " "))) score += 2;

  // Prefer pages whose title mirrors the specific issue (e.g. Cancelling a service…).
  if (intent.specificIssue) {
    const issueTokens = intent.specificIssue.toLowerCase().split(/\W+/).filter((t) => t.length >= 4);
    const titleLower = page.title.toLowerCase();
    const titleHits = issueTokens.filter((t) => titleLower.includes(t)).length;
    if (titleHits >= 1) score += 2 + titleHits;
    if (
      /cancel/i.test(intent.specificIssue) &&
      /\bcancel/i.test(page.title)
    ) {
      score += 6;
    }
  }

  const area = wikiAreaForTaxonomy(intent.taxonomySlug ?? "");
  if (area && page.category === area) score += 3;
  if (isCategoryHubPage(page)) score -= 2;

  // Consumer intents must not land on courts / litigation hubs or LASPO practice directions.
  if (intent.taxonomySlug?.startsWith("consumer")) {
    if (page.category !== "Consumer Rights" && !blob.includes("consumer")) {
      score -= 4;
    }
    if (
      /\b(litigation|practice direction|legal aid, sentencing|part 48|civil procedure)\b/i.test(
        blob,
      ) &&
      !/\b(consumer|trader|cancel|service|refund)\b/i.test(blob)
    ) {
      return -1;
    }
    if (page.category === "Courts and Disputes" || page.category === "Work and Employment") {
      score -= 3;
    }
  }

  for (const term of intent.searchBoostTerms.slice(0, 6)) {
    if (blob.includes(term.toLowerCase())) score += 0.5;
  }

  if (intent.requiredTopicTerms?.some((t) => qLower.includes(t.toLowerCase()) && blob.includes(t.toLowerCase()))) {
    score += 2;
  }

  score += Math.min(3, overlap * 8);

  if (FAMILY_QUERY_SIGNALS.test(qLower) && page.category === "Family and Relationships") {
    score += 3;
  }
  if (CUSTOMS_QUERY_SIGNALS.test(qLower) && page.category === "Consumer Rights") {
    score += 3;
  }
  if (CUSTOMS_QUERY_SIGNALS.test(qLower) && page.category === "Immigration and Citizenship") {
    return -1;
  }
  if (FAMILY_QUERY_SIGNALS.test(qLower) && page.category === "Home and Housing") {
    return -1;
  }

  if (page.summary.length > 40) score += 0.5;
  if (embeddingBoost > 0) score += embeddingBoost * 2;
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
