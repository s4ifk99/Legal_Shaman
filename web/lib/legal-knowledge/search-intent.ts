import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import { inferSubIssueFromTaxonomy } from "@/lib/legal/sub-issue-rules";
import { matcherSlugForTaxonomySlug, rowMatchesPracticeTaxonomySlug } from "@/lib/legal/taxonomy";
import { resolveLegalIssueFromNaturalLanguage } from "@/lib/legal/natural-language-resolver";
import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { ParsedQuerySchema } from "@/lib/legal-search/types";

import type { LegalSearchContext } from "./search-context";
import type { RetrievedChunk } from "./types";

export type IntentConfidence = "high" | "medium" | "low";

export type LegalSearchIntent = {
  taxonomySlug?: string;
  matcherSlug?: string;
  canonicalName?: string;
  specificIssue?: string;
  semanticQuery: string;
  retrievalQueries: string[];
  searchBoostTerms: string[];
  suppressTerms: string[];
  requiredTopicTerms: string[];
  confidence: IntentConfidence;
  signals: string[];
};

const OFFICIAL_DOMAIN_SLUGS: Record<string, string> = {
  "acas.gov.uk": "employment",
  "gov.uk": "employment",
};

const WIKI_PATH_SLUG_HINTS: Array<{ pattern: RegExp; slug: string }> = [
  { pattern: /\/employment|\/workplace|\/wage|\/commission/i, slug: "employment" },
  { pattern: /\/landlord|\/tenant|\/housing|\/deposit|\/evict/i, slug: "housing" },
  { pattern: /\/immigration|\/visa|\/asylum/i, slug: "immigration" },
  { pattern: /\/family|\/divorce|\/child/i, slug: "family" },
  { pattern: /\/criminal|\/police/i, slug: "criminal_defence" },
  { pattern: /\/benefits|\/universal credit/i, slug: "welfare_benefits" },
  { pattern: /\/debt|\/bailiff/i, slug: "debt" },
];

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

const SUPPRESS_BY_SLUG: Record<string, string[]> = {
  employment: ["company", "llp", "limited liability"],
};

function intentConfidenceFromMatchStrength(strength: number): IntentConfidence {
  if (strength >= 0.28) return "high";
  if (strength >= 0.12) return "medium";
  return "low";
}

function buildSemanticQuery(
  query: string,
  canonicalName?: string,
  specificIssue?: string,
  parsedSemantic?: string,
): string {
  if (canonicalName && specificIssue) {
    return `${canonicalName} — ${specificIssue}`.slice(0, 400);
  }
  if (canonicalName) {
    return `${canonicalName} issue: ${query}`.slice(0, 400);
  }
  if (parsedSemantic?.trim() && parsedSemantic.trim() !== query) {
    return parsedSemantic.trim().slice(0, 400);
  }
  return query.slice(0, 400);
}

function buildRetrievalQueries(
  query: string,
  expanded: string,
  boostTerms: string[],
  specificIssue?: string,
): string[] {
  const queries = new Set<string>();
  queries.add(expanded.trim() || query);
  if (specificIssue) {
    queries.add(`${query} ${specificIssue}`.trim());
    queries.add(specificIssue);
  }
  const boost = boostTerms.slice(0, 8).join(" ");
  if (boost) queries.add(`${query} ${boost}`.trim().slice(0, 400));
  return [...queries].filter((q) => q.length >= 2).slice(0, 4);
}

function slugFromChunk(chunk: RetrievedChunk): string | null {
  const blob = `${chunk.title} ${chunk.sourceUrl} ${chunk.domain} ${chunk.chunkText}`.toLowerCase();
  if (chunk.domain.includes("acas")) return "employment";
  for (const [domain, slug] of Object.entries(OFFICIAL_DOMAIN_SLUGS)) {
    if (chunk.domain.includes(domain) && slug === "employment" && /employ|wage|commission|workplace/i.test(blob)) {
      return slug;
    }
  }
  for (const { pattern, slug } of WIKI_PATH_SLUG_HINTS) {
    if (pattern.test(chunk.sourceUrl) || pattern.test(chunk.title)) return slug;
  }
  let best: { slug: string; score: number } | null = null;
  for (const entry of LEGAL_ISSUE_TAXONOMY) {
    const resolution = resolveLegalIssueFromNaturalLanguage(blob.slice(0, 500));
    if (resolution?.taxonomySlug === entry.slug && resolution.matchStrength > 0.1) {
      const score = resolution.matchStrength;
      if (!best || score > best.score) best = { slug: entry.slug, score };
    }
  }
  return best?.slug ?? null;
}

/** Slugs accepted when filtering directory results for a citizen issue area. */
const DIRECTORY_SLUG_OVERLAP: Record<string, string[]> = {
  conveyancing: ["conveyancing", "housing"],
};

/** Practice area slug sent to directory search — prefer citizen issue over matcher bucket. */
export function directoryPracticeAreaForIntent(intent: LegalSearchIntent): string | undefined {
  return intent.taxonomySlug ?? intent.matcherSlug;
}

export function directoryPracticeAreaSlugsForIntent(intent: LegalSearchIntent): string[] {
  const primary = directoryPracticeAreaForIntent(intent);
  if (!primary) return [];
  const overlap = DIRECTORY_SLUG_OVERLAP[primary] ?? [];
  return [...new Set([primary, ...overlap])];
}

export function directoryRowMatchesPracticeArea(
  result: SearchResult,
  slugs: string[],
): boolean {
  if (!slugs.length) return true;
  const raw = result.raw as { practiceAreaSlugs?: string[] } | null;
  if (raw?.practiceAreaSlugs?.some((s) => slugs.includes(s.toLowerCase()))) return true;

  const hay = `${result.title} ${result.description ?? ""} ${result.practiceAreas.join(" ")} ${result.categories.join(" ")}`;
  return slugs.some(
    (slug) =>
      rowMatchesPracticeTaxonomySlug(slug, hay) ||
      result.practiceAreas.some((x) => x.toLowerCase().includes(slug.replace(/_/g, " "))) ||
      result.categories.some((c) => c.toLowerCase().includes(slug.replace(/_/g, " "))),
  );
}

/** Derive search intent from parsed context before guidance retrieval. */
export function deriveLegalSearchIntent(context: LegalSearchContext): LegalSearchIntent {
  const { query, parsedQuery, resolution, classification, fusion } = context;
  const signals: string[] = [];

  const taxonomySlug =
    fusion.taxonomySlug ??
    resolution?.taxonomySlug ??
    parsedQuery.taxonomySlug ??
    (classification.subArea || undefined);

  const matcherSlug =
    fusion.matcherSlug ??
    resolution?.matcherSlug ??
    parsedQuery.practiceAreaSlug ??
    (taxonomySlug ? matcherSlugForTaxonomySlug(taxonomySlug) : undefined) ??
    undefined;

  const entry = taxonomySlug
    ? LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === taxonomySlug)
    : undefined;
  const canonicalName =
    fusion.canonicalName ??
    resolution?.canonicalName ??
    entry?.canonicalName ??
    parsedQuery.taxonomyPrimaryLabel;
  const specificIssue =
    fusion.specificIssue ??
    classification.specificIssue ??
    (taxonomySlug ? inferSubIssueFromTaxonomy(query, taxonomySlug) : null) ??
    undefined;

  const boostTerms = [
    ...(fusion.searchBoostTerms ?? []),
    ...(resolution?.searchBoostTerms ?? []),
    ...(entry?.searchBoostTerms ?? []),
    ...(specificIssue ? [specificIssue] : []),
  ];
  const expanded =
    parsedQuery.expandedSearchText?.trim() ||
    (resolution ? `${query} ${boostTerms.slice(0, 10).join(" ")}` : query);

  if (taxonomySlug) signals.push(`taxonomy:${taxonomySlug}`);
  if (specificIssue) signals.push(`subIssue:${specificIssue}`);
  if (fusion.fusionSource === "llm") signals.push(`llm:${taxonomySlug ?? "unknown"}`);
  if (fusion.fusionSource === "rules") signals.push(`rules:${taxonomySlug ?? "unknown"}`);
  if (fusion.fusionSource === "agreed") signals.push(`agreed:${taxonomySlug ?? "unknown"}`);

  let confidence = fusion.confidence;
  if (!fusion.taxonomySlug && !taxonomySlug && parsedQuery.queryConfidence === "medium") {
    confidence = "medium";
  }
  if (!fusion.taxonomySlug && !taxonomySlug) {
    const matchStrength = resolution?.matchStrength ?? 0;
    confidence = intentConfidenceFromMatchStrength(matchStrength);
  }

  const requiredTopicTerms = taxonomySlug
    ? (TOPIC_TERMS_BY_SLUG[taxonomySlug] ?? [taxonomySlug.replace(/_/g, " ")])
    : [];

  const suppressTerms =
    taxonomySlug && SUPPRESS_BY_SLUG[taxonomySlug]
      ? SUPPRESS_BY_SLUG[taxonomySlug]!.filter((t) => query.toLowerCase().includes(t))
      : [];

  const semanticQuery = buildSemanticQuery(
    query,
    canonicalName,
    specificIssue,
    fusion.semanticQuery ?? parsedQuery.semanticQuery,
  );

  return {
    taxonomySlug,
    matcherSlug: matcherSlug ?? undefined,
    canonicalName,
    specificIssue,
    semanticQuery,
    retrievalQueries: buildRetrievalQueries(query, expanded, boostTerms, specificIssue),
    searchBoostTerms: [...new Set(boostTerms.map((t) => t.toLowerCase()))].slice(0, 16),
    suppressTerms,
    requiredTopicTerms,
    confidence,
    signals,
  };
}

/** Refine intent using top retrieved guidance chunks (second pass). */
export function refineIntentFromChunks(
  intent: LegalSearchIntent,
  chunks: RetrievedChunk[],
): LegalSearchIntent {
  if (!chunks.length) return intent;

  const slugVotes = new Map<string, number>();
  for (const chunk of chunks.slice(0, 8)) {
    const slug = slugFromChunk(chunk);
    if (!slug) continue;
    slugVotes.set(slug, (slugVotes.get(slug) ?? 0) + chunk.finalScore);
  }

  let bestSlug: string | undefined;
  let bestScore = 0;
  for (const [slug, score] of slugVotes) {
    if (score > bestScore) {
      bestScore = score;
      bestSlug = slug;
    }
  }

  if (!bestSlug || (intent.taxonomySlug && bestSlug === intent.taxonomySlug)) {
    return intent;
  }

  const querySlugScore = intent.taxonomySlug ? slugVotes.get(intent.taxonomySlug) ?? 0 : 0;
  if (intent.confidence === "high" && querySlugScore >= bestScore * 0.7) {
    return intent;
  }
  if (bestScore < 0.15) return intent;

  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === bestSlug);
  const signals = [...intent.signals, `guidance:${bestSlug}`];

  return {
    ...intent,
    taxonomySlug: bestSlug,
    matcherSlug: matcherSlugForTaxonomySlug(bestSlug) ?? intent.matcherSlug,
    canonicalName: entry?.canonicalName ?? intent.canonicalName,
    requiredTopicTerms: TOPIC_TERMS_BY_SLUG[bestSlug] ?? intent.requiredTopicTerms,
    suppressTerms: SUPPRESS_BY_SLUG[bestSlug]?.filter((t) => intent.semanticQuery.toLowerCase().includes(t)) ?? intent.suppressTerms,
    confidence: intent.confidence === "low" ? "medium" : intent.confidence,
    signals,
  };
}

export function chunkMatchesIntent(chunk: RetrievedChunk, intent: LegalSearchIntent): boolean {
  const blob = `${chunk.title} ${chunk.sourceUrl} ${chunk.heading ?? ""} ${chunk.chunkText}`.toLowerCase();

  if (intent.suppressTerms.some((t) => blob.includes(t.toLowerCase()))) {
    const hasRequired = intent.requiredTopicTerms.some((t) => blob.includes(t.toLowerCase()));
    if (!hasRequired) return false;
  }

  if (!intent.requiredTopicTerms.length) return true;

  const isWikiIndex =
    /—\s*sources$/i.test(chunk.title) ||
    /—\s*key information$/i.test(chunk.title) ||
    /\/_index/i.test(chunk.sourceUrl);

  if (isWikiIndex && intent.taxonomySlug) {
    const onTopic = intent.requiredTopicTerms.some((t) => blob.includes(t.toLowerCase()));
    if (!onTopic) return false;
  }

  return intent.requiredTopicTerms.some((t) => blob.includes(t.toLowerCase()));
}

export function filterChunksByIntent(chunks: RetrievedChunk[], intent: LegalSearchIntent): RetrievedChunk[] {
  if (!intent.requiredTopicTerms.length) return chunks;
  const filtered = chunks.filter((c) => chunkMatchesIntent(c, intent));
  return filtered.length ? filtered : chunks;
}

/** Merge search intent into a parsed query for directory ranking. */
export function overlayIntentOnParsedQuery(
  parsed: ParsedQuery,
  intent: LegalSearchIntent,
): ParsedQuery {
  return ParsedQuerySchema.parse({
    ...parsed,
    semanticQuery: intent.semanticQuery || parsed.semanticQuery,
    expandedSearchText: intent.retrievalQueries[0] ?? parsed.expandedSearchText,
    taxonomySlug: intent.taxonomySlug ?? parsed.taxonomySlug,
    practiceAreaSlug: directoryPracticeAreaForIntent(intent) ?? parsed.practiceAreaSlug,
    taxonomyPrimaryLabel: intent.canonicalName ?? parsed.taxonomyPrimaryLabel,
    queryConfidence:
      intent.confidence === "high"
        ? "high"
        : intent.confidence === "medium"
          ? "medium"
          : parsed.queryConfidence,
  });
}

/** Drop directory hits that only match suppressed noise terms (e.g. "company" in firm name). */
export function filterDirectoryResultsByIntent(
  results: SearchResult[],
  intent: LegalSearchIntent,
): SearchResult[] {
  if (!intent.suppressTerms.length) return results;

  return results.filter((r) => {
    const titleLower = r.title.toLowerCase();
    const suppressedOnly = intent.suppressTerms.some(
      (t) =>
        titleLower.includes(t.toLowerCase()) &&
        !intent.requiredTopicTerms.some((req) =>
          `${r.title} ${r.practiceAreas.join(" ")}`.toLowerCase().includes(req.toLowerCase()),
        ),
    );
    if (!suppressedOnly) return true;
    const practiceMatch =
      intent.matcherSlug &&
      r.practiceAreas.some((p) => p.toLowerCase().includes(intent.matcherSlug!.replace(/_/g, " ")));
    return Boolean(practiceMatch);
  });
}
