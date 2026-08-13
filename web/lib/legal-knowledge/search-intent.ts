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
  discrimination_equality: [
    "discrimination",
    "equality",
    "equality act",
    "protected characteristic",
    "harassment",
    "services",
  ],
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

const SUPPRESS_BY_SLUG: Record<string, string[]> = {
  employment: ["company", "llp", "limited liability"],
  discrimination_equality: ["consultant solicitor", "llp", "becoming a"],
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
  // Keep Typesense / directory queries short — long Reddit posts time out multi_search.
  const shortQuery = query.replace(/\s+/g, " ").trim().slice(0, 120);
  if (canonicalName && specificIssue) {
    return `${canonicalName} — ${specificIssue}`.slice(0, 160);
  }
  if (canonicalName) {
    return `${canonicalName}: ${shortQuery}`.slice(0, 160);
  }
  if (parsedSemantic?.trim() && parsedSemantic.trim() !== query) {
    return parsedSemantic.trim().slice(0, 160);
  }
  return shortQuery;
}

/** Prefer compact legal phrases over long Reddit-style narrative for wiki retrieval. */
export function compactRetrievalSeed(query: string, maxLen = 160): string {
  const collapsed = query.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;

  const sentences = collapsed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const scored = sentences
    .map((s) => {
      let score = 0;
      if (/\b(equality act|discriminat|trading standards|unfair dismissal|party wall|consumer rights)\b/i.test(s)) {
        score += 5;
      }
      if (/\b(could this|what (are|is|can)|should i|how (do|can)|complain|rights)\b/i.test(s)) {
        score += 3;
      }
      if (s.length < 40) score -= 1;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score || a.s.length - b.s.length);

  const pick = scored[0]?.s;
  if (pick && pick.length >= 24) return pick.slice(0, maxLen);
  return collapsed.slice(0, maxLen);
}

function buildRetrievalQueries(
  query: string,
  expanded: string,
  boostTerms: string[],
  specificIssue?: string,
  options?: { preferCompact?: boolean; forcedQueries?: string[] },
): string[] {
  const short = options?.preferCompact
    ? compactRetrievalSeed(query, 160)
    : query.replace(/\s+/g, " ").trim().slice(0, 160);
  const shortExpanded = options?.preferCompact
    ? compactRetrievalSeed(expanded, 160)
    : expanded.replace(/\s+/g, " ").trim().slice(0, 160);
  const queries = new Set<string>();
  for (const fq of options?.forcedQueries ?? []) {
    if (fq.trim().length >= 8) queries.add(fq.trim().slice(0, 160));
  }
  queries.add(shortExpanded || short);
  if (specificIssue) {
    queries.add(`${specificIssue} ${short}`.trim().slice(0, 160));
    queries.add(specificIssue);
  }
  const boost = boostTerms.slice(0, 8).join(" ");
  if (boost) queries.add(`${short} ${boost}`.trim().slice(0, 160));
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
  consumer: ["consumer", "consumer_online_shopping", "consumer_small_claims"],
  consumer_services: ["consumer", "consumer_services", "consumer_small_claims"],
  consumer_online_shopping: ["consumer", "consumer_online_shopping"],
};

export const UNSAFE_PRODUCT_QUERY =
  /\b(temu|amazon|ebay|aliexpress|marketplace|seller|bought online|purchased online|unsafe product|dangerous product|faulty goods|trading standards|consumer service|product recall|report this|report them|who do i report|lead test|lead contamination|tap[s]?\b|water fitting|drinking water contamination)\b/i;

/** Employment-context signals — used to avoid mistaking services discrimination for workplace claims. */
export const EMPLOYMENT_CONTEXT_QUERY =
  /\b(employer|employee|at work|workplace|unfair dismissal|redundan|acas|employment tribunal|grievance|colleague|line manager|HR department|hr\b|job|contract of employment|payroll|wages|maternity leave|paternity leave)\b/i;

/**
 * Equality Act / discrimination in goods, facilities or services (gyms, shops, leisure)
 * rather than workplace discrimination.
 */
export const EQUALITY_SERVICES_QUERY =
  /\b(equality act|discriminat|protected characteristic|sex discrimination|indirect discrimination|direct discrimination)\b/i;

export const SERVICES_PROVIDER_CONTEXT_QUERY =
  /\b(gym|leisure|sauna|steam room|shower|changing room|cubicle|customer|clientele|member|membership|service provider|goods and services|shop|restaurant|hotel|club|facility|facilities)\b/i;

export function isUnsafeProductQuery(query: string): boolean {
  return UNSAFE_PRODUCT_QUERY.test(query);
}

export function isEqualityServicesQuery(query: string): boolean {
  if (EMPLOYMENT_CONTEXT_QUERY.test(query) && !SERVICES_PROVIDER_CONTEXT_QUERY.test(query)) {
    return false;
  }
  const hasEquality = EQUALITY_SERVICES_QUERY.test(query);
  const hasServices = SERVICES_PROVIDER_CONTEXT_QUERY.test(query);
  // Explicit Equality Act + services context, or discrimination language + gym/customer framing.
  return (hasEquality && hasServices) || (hasEquality && /\bgym|leisure|sauna|shower|changing room\b/i.test(query));
}

/** Directory search query — keep short for Postgres/Typesense latency. */
export function directorySearchQueryForIntent(query: string, intent: LegalSearchIntent): string {
  if (isUnsafeProductQuery(query)) {
    return "consumer rights solicitor";
  }
  if (intent.canonicalName && intent.specificIssue) {
    return `${intent.canonicalName} ${intent.specificIssue}`.slice(0, 80);
  }
  if (intent.canonicalName) {
    return `${intent.canonicalName} solicitor`.slice(0, 80);
  }
  return intent.semanticQuery.slice(0, 80);
}

/** Practice area slug sent to directory search — prefer citizen issue over matcher bucket. */
export function directoryPracticeAreaForIntent(
  intent: LegalSearchIntent,
  query?: string,
): string | undefined {
  // Unsafe product / Trading Standards cases: do not hard-filter by practice area.
  // SRA firms rarely tag "consumer", and keyword matching on "service" is too noisy.
  if (query && isUnsafeProductQuery(query)) return undefined;
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

  const practiceHay = `${result.description ?? ""} ${result.practiceAreas.join(" ")} ${result.categories.join(" ")}`;
  return slugs.some(
    (slug) =>
      rowMatchesPracticeTaxonomySlug(slug, practiceHay) ||
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
  let resolvedTaxonomySlug = taxonomySlug;
  let resolvedMatcherSlug = matcherSlug ?? undefined;
  let resolvedCanonicalName = canonicalName;
  let resolvedSpecificIssue = specificIssue;
  let resolvedBoostTerms = [...boostTerms];

  // Services discrimination (gym/customer) must not fall through employment retrieval.
  if (isEqualityServicesQuery(query)) {
    resolvedTaxonomySlug = "discrimination_equality";
    resolvedMatcherSlug = "discrimination_equality";
    resolvedCanonicalName = "Discrimination and Equality";
    resolvedSpecificIssue =
      resolvedSpecificIssue && !/at work|workplace|employment/i.test(resolvedSpecificIssue)
        ? resolvedSpecificIssue
        : "discrimination in goods and services";
    resolvedBoostTerms = [
      "equality act",
      "discrimination in goods and services",
      "sex discrimination",
      "protected characteristic",
      "service provider",
      ...resolvedBoostTerms,
    ];
    signals.push("pattern:equality_services");
  }

  const expanded =
    parsedQuery.expandedSearchText?.trim() ||
    (resolution
      ? `${query} ${resolvedBoostTerms.slice(0, 10).join(" ")}`
      : query);

  if (resolvedTaxonomySlug) signals.push(`taxonomy:${resolvedTaxonomySlug}`);
  if (resolvedSpecificIssue) signals.push(`subIssue:${resolvedSpecificIssue}`);
  if (fusion.fusionSource === "llm") signals.push(`llm:${resolvedTaxonomySlug ?? "unknown"}`);
  if (fusion.fusionSource === "rules") signals.push(`rules:${resolvedTaxonomySlug ?? "unknown"}`);
  if (fusion.fusionSource === "agreed") signals.push(`agreed:${resolvedTaxonomySlug ?? "unknown"}`);

  let confidence = fusion.confidence;
  if (!fusion.taxonomySlug && !resolvedTaxonomySlug && parsedQuery.queryConfidence === "medium") {
    confidence = "medium";
  }
  if (!fusion.taxonomySlug && !resolvedTaxonomySlug) {
    const matchStrength = resolution?.matchStrength ?? 0;
    confidence = intentConfidenceFromMatchStrength(matchStrength);
  }
  if (isEqualityServicesQuery(query)) confidence = "high";

  const requiredTopicTerms = resolvedTaxonomySlug
    ? (TOPIC_TERMS_BY_SLUG[resolvedTaxonomySlug] ?? [
        resolvedTaxonomySlug.replace(/_/g, " "),
      ])
    : [];

  const suppressTerms =
    resolvedTaxonomySlug && SUPPRESS_BY_SLUG[resolvedTaxonomySlug]
      ? SUPPRESS_BY_SLUG[resolvedTaxonomySlug]!
      : [];

  const preferCompact = query.replace(/\s+/g, " ").trim().length > 220;
  const forcedQueries = isEqualityServicesQuery(query)
    ? [
        "discrimination in provision of services equality act 2010",
        "taking action about discrimination in goods and services",
        "protected characteristics discrimination equality act",
      ]
    : undefined;

  const semanticQuery = isEqualityServicesQuery(query)
    ? "Discrimination and Equality — discrimination in goods and services".slice(0, 160)
    : buildSemanticQuery(
        preferCompact ? compactRetrievalSeed(query, 120) : query,
        resolvedCanonicalName,
        resolvedSpecificIssue,
        fusion.semanticQuery ?? parsedQuery.semanticQuery,
      );

  return {
    taxonomySlug: resolvedTaxonomySlug,
    matcherSlug: resolvedMatcherSlug,
    canonicalName: resolvedCanonicalName,
    specificIssue: resolvedSpecificIssue,
    semanticQuery,
    retrievalQueries: buildRetrievalQueries(
      query,
      expanded,
      resolvedBoostTerms,
      resolvedSpecificIssue,
      { preferCompact, forcedQueries },
    ),
    searchBoostTerms: [...new Set(resolvedBoostTerms.map((t) => t.toLowerCase()))].slice(0, 16),
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
