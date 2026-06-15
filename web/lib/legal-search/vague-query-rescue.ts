import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import {
  LEGAL_ISSUE_TAXONOMY,
  type LegalIssueTaxonomyEntry,
} from "@/lib/legal/legal-issue-taxonomy-data";
import {
  narrowHintsFromTaxonomyEntry,
  refinementChipsFromEntry,
  refinementChipsFromHints,
} from "@/lib/legal/refinement-chips";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import {
  LEGAL_ENTITIES_QUERY_BY,
  LEGAL_ENTITIES_QUERY_BY_EXPANDED,
  LEGAL_ENTITIES_QUERY_BY_EXPANDED_WEIGHTS,
  LEGAL_ENTITIES_QUERY_BY_WEIGHTS,
  performLegalEntitiesMultiSearch,
  searchLegalEntitiesMulti,
  type LegalEntitiesHit,
} from "@/lib/search-index/typesense-legal-entities-search";
import { taxonomyFallbackQuery } from "@/lib/search-index/taxonomy-projection";

/** Generic wording that signals a broad directory query (not a specific sub-issue). */
export const VAGUE_GENERIC_TERMS = [
  "need",
  "lawyer",
  "solicitor",
  "advice",
  "help",
  "issue",
  "problem",
  "looking",
  "find",
  "want",
] as const;

export type TaxonomyMatch = {
  slug: string;
  label: string;
  relatedLabels: string[];
};

export type VagueQueryRescuePlan = {
  taxonomySlug: string;
  canonicalName: string;
  matcherSlug: string;
  /** Typesense / lexical queries (deduped, ordered). */
  retrievalQueries: string[];
  /** Terms that must appear for a hit to be kept (any one). */
  signalTerms: string[];
  /** Related practice labels allowed when paired with bridge terms (e.g. prison + criminal defence). */
  relatedAreaLabels: string[];
  /** Bridge terms required when matching a related area only (not canonical). */
  relatedBridgeTerms: string[];
  legalAidLikely: boolean;
  narrowHints: string[];
  /** Broad Typesense retry when initial retrieval returns zero hits. */
  zeroResultFallbackQuery: string;
};

export type VagueQueryDetectOptions = {
  cityFilter?: string;
  locationFilter?: string;
  practiceAreaFilter?: string;
  languageFilter?: string;
  verifiedOnly?: boolean;
  legalAidOnly?: boolean;
};

export type VagueRescueSearchParams = {
  limit: number;
  filterBy?: string;
  geoSortLat?: number;
  geoSortLng?: number;
  locationQ?: string;
};

const bySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));

/** Resolved taxonomy match from a parsed query. */
export function getTaxonomyMatch(parsed: ParsedQuery): TaxonomyMatch | null {
  const slug = parsed.taxonomySlug?.trim();
  if (!slug) return null;
  const entry = bySlug.get(slug);
  const label = parsed.taxonomyPrimaryLabel?.trim() || entry?.canonicalName || slug;
  const relatedLabels =
    parsed.taxonomyRelatedLabels?.length
      ? parsed.taxonomyRelatedLabels
      : entry?.relatedPracticeAreas ?? [];
  return { slug, label, relatedLabels };
}

function uniqueNonEmpty(strings: string[], max = 24): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of strings) {
    const t = s.trim();
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9']+/i)
    .map((t) => t.replace(/'/g, ""))
    .filter((t) => t.length > 1);
}

function countSpecificFacts(raw: string): number {
  const tokens = tokenize(raw);
  const generic = new Set<string>([...VAGUE_GENERIC_TERMS, "legal", "law", "uk", "a", "an", "the"]);
  return tokens.filter((t) => t.length > 2 && !generic.has(t)).length;
}

function queryHasGenericVagueTerms(raw: string): boolean {
  const lower = raw.toLowerCase();
  return VAGUE_GENERIC_TERMS.some((t) => new RegExp(`\\b${t}\\b`, "i").test(lower));
}

function hasStrongSubIssueInQuery(raw: string, entry: LegalIssueTaxonomyEntry): boolean {
  const lower = raw.toLowerCase();
  for (const sub of entry.subIssues) {
    const s = sub.trim().toLowerCase();
    if (s.length < 5) continue;
    if (lower.includes(s)) return true;
    const words = s.split(/\s+/).filter((w) => w.length > 3);
    if (words.length >= 2 && words.every((w) => lower.includes(w))) return true;
  }
  return false;
}

function hasExplicitLocationOrFilters(
  parsed: ParsedQuery,
  opts?: VagueQueryDetectOptions,
): boolean {
  if (parsed.postcode?.trim()) return true;
  if (parsed.location?.trim()) return true;
  if (opts?.cityFilter?.trim()) return true;
  if (opts?.locationFilter?.trim()) return true;
  if (opts?.practiceAreaFilter?.trim()) return true;
  if (opts?.languageFilter?.trim()) return true;
  if (opts?.verifiedOnly) return true;
  if (opts?.legalAidOnly) return true;
  return false;
}

/**
 * Broad but understandable legal queries: medium confidence + taxonomy, few specifics.
 */
export function detectVagueLegalQuery(
  parsed: ParsedQuery,
  opts?: VagueQueryDetectOptions,
): boolean {
  if (parsed.queryConfidence !== "medium") return false;
  const match = getTaxonomyMatch(parsed);
  if (!match) return false;

  const raw = (parsed.rawText ?? parsed.semanticQuery ?? "").trim();
  if (raw.length < 3) return false;
  if (hasExplicitLocationOrFilters(parsed, opts)) return false;

  const entry = bySlug.get(match.slug);
  if (entry && hasStrongSubIssueInQuery(raw, entry)) return false;

  const specifics = countSpecificFacts(raw);
  if (specifics > 4) return false;

  if (!queryHasGenericVagueTerms(raw) && specifics > 2) return false;

  return true;
}

/** Bridge terms for related-area-only matches (e.g. Criminal Defence for prison queries). */
function relatedBridgeTermsForEntry(entry: LegalIssueTaxonomyEntry): string[] {
  const base = uniqueNonEmpty([
    ...entry.searchBoostTerms,
    ...entry.aliases,
    ...entry.subIssues.slice(0, 6),
    entry.canonicalName,
    entry.slug.replace(/_/g, " "),
  ], 20);
  if (entry.slug === "prison_law") {
    return uniqueNonEmpty([
      ...base,
      "prison",
      "prisoner",
      "parole",
      "recall",
      "police custody",
      "hmp",
      "licence recall",
    ]);
  }
  return base;
}

/**
 * Build multi-query rescue plan from taxonomy entry + parsed query.
 */
export function buildVagueQueryRescuePlan(parsed: ParsedQuery): VagueQueryRescuePlan | null {
  const match = getTaxonomyMatch(parsed);
  if (!match) return null;
  const entry = bySlug.get(match.slug);
  if (!entry) return null;

  const canonical = entry.canonicalName;
  const aliases = entry.aliases;
  const related = entry.relatedPracticeAreas;
  const legalAidTerms = entry.legalAidLikely
    ? ["Legal Aid", "legal aid provider", "LAA"]
    : [];

  const broadFallback = uniqueNonEmpty(
    [
      canonical,
      `${canonical} solicitor`,
      ...aliases.slice(0, 4),
      ...entry.searchBoostTerms.slice(0, 8),
      ...related.slice(0, 4),
      ...legalAidTerms,
      parsed.expandedSearchText ?? "",
    ],
    18,
  );

  const retrievalQueries = uniqueNonEmpty(
    [
      canonical,
      ...aliases,
      ...related.map((r) => `${r} solicitor`),
      ...entry.searchBoostTerms.slice(0, 6),
      ...legalAidTerms,
      broadFallback[0] ?? canonical,
    ],
    14,
  );

  const signalTerms = uniqueNonEmpty(
    [
      canonical.toLowerCase(),
      ...aliases.map((a) => a.toLowerCase()),
      ...entry.searchBoostTerms.map((t) => t.toLowerCase()),
      ...entry.subIssues.map((s) => s.toLowerCase()),
      ...related.map((r) => r.toLowerCase()),
      ...legalAidTerms.map((t) => t.toLowerCase()),
      match.slug.replace(/_/g, " "),
    ],
    40,
  );

  const narrowHints = narrowHintsFromTaxonomyEntry(entry);

  return {
    taxonomySlug: match.slug,
    canonicalName: canonical,
    matcherSlug: entry.matcherSlug,
    retrievalQueries,
    signalTerms,
    relatedAreaLabels: related,
    relatedBridgeTerms: relatedBridgeTermsForEntry(entry),
    legalAidLikely: entry.legalAidLikely,
    narrowHints,
    zeroResultFallbackQuery:
      taxonomyFallbackQuery(match.slug) ||
      [canonical, ...related, ...legalAidTerms].join(" ").trim(),
  };
}

/** Medium-confidence taxonomy query with no Typesense hits — run broad retry. */
export function shouldTriggerTaxonomyZeroResultRescue(
  parsed: ParsedQuery,
  hitCount: number,
): boolean {
  if (hitCount > 0) return false;
  if (!getTaxonomyMatch(parsed)) return false;
  return parsed.queryConfidence === "medium" || detectVagueLegalQuery(parsed);
}

export function buildTaxonomyFallbackNotice(plan: VagueQueryRescuePlan): string | null {
  if (plan.taxonomySlug !== "prison_law") return null;
  const related = plan.relatedAreaLabels.slice(0, 3).join(" and ");
  return `We found related ${related || "Criminal Defence and Legal Aid"} providers because dedicated Prison Law listings are limited.`;
}

/** Intro copy for vague / medium-confidence directory search (chips carry refinements). */
export function buildVagueRefinementSummary(
  parsed: ParsedQuery,
  plan?: VagueQueryRescuePlan | null,
): string {
  const p = plan ?? buildVagueQueryRescuePlan(parsed);
  if (!p) return parsed.taxonomySummary?.trim() ?? parsed.refinementQuestion?.trim() ?? "";

  const related = p.relatedAreaLabels.slice(0, 4).join(", ");
  if (related) {
    return `Here are results related to ${p.canonicalName} and ${related}.`;
  }
  return `Here are results related to ${p.canonicalName}.`;
}

/** @deprecated Use buildVagueRefinementSummary; kept for eval scripts. */
export function buildVagueRefinementPrompt(
  parsed: ParsedQuery,
  plan?: VagueQueryRescuePlan | null,
): string {
  return buildVagueRefinementSummary(parsed, plan);
}

function docFieldsHaystack(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const d = raw as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of [
    "expandedSearchText",
    "searchText",
    "taxonomyAliases",
    "relatedPracticeAreas",
    "practiceAreaSlugs",
  ]) {
    const v = d[key];
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) parts.push(...(v as string[]));
  }
  return parts.join(" ").toLowerCase();
}

function resultHaystack(r: SearchResult): string {
  return `${r.title} ${r.description ?? ""} ${r.practiceAreas.join(" ")} ${r.categories.join(" ")} ${docFieldsHaystack(r.raw)}`.toLowerCase();
}

export type TaxonomySignalKind =
  | "canonical"
  | "alias"
  | "subissue"
  | "related"
  | "legal_aid"
  | "category"
  | "none";

/** Classify how a result relates to the rescue plan. */
export function classifyTaxonomySignal(
  r: SearchResult,
  plan: VagueQueryRescuePlan,
): TaxonomySignalKind {
  const hay = resultHaystack(r);
  const canonical = plan.canonicalName.toLowerCase();

  const raw = r.raw as Record<string, unknown> | undefined;
  const slugs = Array.isArray(raw?.practiceAreaSlugs)
    ? (raw!.practiceAreaSlugs as string[])
    : [];
  if (slugs.some((s) => s === plan.taxonomySlug)) return "canonical";

  if (hay.includes(canonical) || hay.includes(plan.taxonomySlug.replace(/_/g, " "))) {
    return "canonical";
  }

  const entry = bySlug.get(plan.taxonomySlug);
  if (entry) {
    for (const a of entry.aliases) {
      if (a.length > 3 && hay.includes(a.toLowerCase())) return "alias";
    }
    for (const s of entry.subIssues) {
      if (s.length > 4 && hay.includes(s.toLowerCase())) return "subissue";
    }
  }

  for (const rel of plan.relatedAreaLabels) {
    const rl = rel.toLowerCase();
    if (rl.length < 3) continue;
    if (!hay.includes(rl)) continue;
    if (plan.taxonomySlug === "prison_law" && rl.includes("criminal")) {
      const prisonSpecific = ["prison", "prisoner", "parole", "recall", "custody", "hmp", "licence"];
      if (!prisonSpecific.some((p) => hay.includes(p))) continue;
      return "related";
    }
    const needsBridge = rl.includes("criminal") || rl.includes("defence");
    if (needsBridge) {
      const bridge = plan.relatedBridgeTerms.some((b) => {
        const bl = b.toLowerCase();
        if (bl.includes("criminal") && !bl.includes("prison")) return false;
        return hay.includes(bl);
      });
      if (!bridge) continue;
    }
    return "related";
  }

  if (/\blegal\s*aid\b/i.test(hay) || r.source === "legal_aid") {
    if (plan.legalAidLikely) return "legal_aid";
  }

  for (const c of r.categories) {
    const cl = c.toLowerCase();
    if (plan.signalTerms.some((t) => t.length > 3 && cl.includes(t))) return "category";
  }

  for (const t of plan.signalTerms) {
    if (t.length < 5 || !hay.includes(t)) continue;
    if (
      plan.taxonomySlug === "prison_law" &&
      (t.includes("criminal") || t.includes("defence")) &&
      !["prison", "prisoner", "parole", "recall", "custody", "hmp", "licence"].some((p) =>
        hay.includes(p),
      )
    ) {
      continue;
    }
    return "alias";
  }

  return "none";
}

export function resultHasTaxonomySignal(r: SearchResult, plan: VagueQueryRescuePlan): boolean {
  return classifyTaxonomySignal(r, plan) !== "none";
}

/** Drop unrelated hits; keep related-area matches only with bridge terms. */
export function filterVagueRescueResults(
  results: SearchResult[],
  plan: VagueQueryRescuePlan,
): SearchResult[] {
  return results.filter((r) => resultHasTaxonomySignal(r, plan));
}

export function countUsefulVagueResults(
  results: SearchResult[],
  plan: VagueQueryRescuePlan,
): number {
  return results.filter((r) => {
    if (!resultHasTaxonomySignal(r, plan)) return false;
    return (r.scores?.final ?? 0) >= 0.12 || (r.scores?.practiceArea ?? 0) >= 0.35;
  }).length;
}

export const VAGUE_RELATED_EXPLANATION =
  "Broad query matched through related practice area";

/**
 * Typesense multi_search for vague rescue: canonical, aliases, related, legal aid, fallback, geo.
 */
export type VagueRescueSearchResult = {
  hits: LegalEntitiesHit[];
  degradedModes: string[];
  typesenseQueries: Record<string, unknown>[];
  searchedFields: string[];
  fallbackTriggered: boolean;
};

export async function searchVagueLegalEntitiesMulti(
  plan: VagueQueryRescuePlan,
  params: VagueRescueSearchParams & { includeZeroResultFallback?: boolean },
): Promise<VagueRescueSearchResult> {
  const degradedModes: string[] = [];
  const perPage = Math.min(60, Math.max(30, params.limit));
  const queryBy = LEGAL_ENTITIES_QUERY_BY;
  const queryByExpanded = LEGAL_ENTITIES_QUERY_BY_EXPANDED;

  const searches: Record<string, unknown>[] = [];

  const pushSearch = (q: string, by: string, weights: string) => {
    if (!q.trim()) return;
    searches.push({
      q: q.trim().slice(0, 200),
      query_by: by,
      query_by_weights: weights,
      per_page: perPage,
      filter_by: params.filterBy,
      typo_tolerance: true,
    });
  };

  pushSearch(plan.canonicalName, queryBy, LEGAL_ENTITIES_QUERY_BY_WEIGHTS);
  for (const a of plan.retrievalQueries.filter((q) => q !== plan.canonicalName).slice(0, 3)) {
    pushSearch(a, queryByExpanded, LEGAL_ENTITIES_QUERY_BY_EXPANDED_WEIGHTS);
  }
  for (const rel of plan.relatedAreaLabels.slice(0, 3)) {
    pushSearch(rel, queryByExpanded, LEGAL_ENTITIES_QUERY_BY_EXPANDED_WEIGHTS);
  }
  if (plan.legalAidLikely) {
    pushSearch("Legal Aid", queryByExpanded, LEGAL_ENTITIES_QUERY_BY_EXPANDED_WEIGHTS);
  }
  const fallback = plan.retrievalQueries[plan.retrievalQueries.length - 1] ?? plan.canonicalName;
  pushSearch(fallback, queryBy, LEGAL_ENTITIES_QUERY_BY_WEIGHTS);

  if (params.locationQ?.trim()) {
    pushSearch(
      `${plan.canonicalName} ${params.locationQ.trim()}`,
      queryBy,
      LEGAL_ENTITIES_QUERY_BY_WEIGHTS,
    );
  }

  if (
    params.geoSortLat != null &&
    params.geoSortLng != null &&
    Number.isFinite(params.geoSortLat)
  ) {
    searches.push({
      q: plan.canonicalName || "*",
      query_by: queryBy,
      query_by_weights: LEGAL_ENTITIES_QUERY_BY_WEIGHTS,
      per_page: perPage,
      filter_by: params.filterBy,
      sort_by: `locationPoint(${params.geoSortLat}, ${params.geoSortLng}):asc`,
    });
  }

  if (searches.length === 0) {
    return {
      hits: [],
      degradedModes: ["vague_rescue_no_queries"],
      typesenseQueries: [],
      searchedFields: queryBy.split(","),
      fallbackTriggered: false,
    };
  }

  let { hits, degradedModes: searchDegraded } = await performLegalEntitiesMultiSearch(
    searches,
    params.limit,
  );
  degradedModes.push(...searchDegraded);
  let fallbackTriggered = false;

  if (hits.length === 0 && params.includeZeroResultFallback !== false && plan.zeroResultFallbackQuery) {
    fallbackTriggered = true;
    degradedModes.push("taxonomy_zero_result_fallback");
    const fallbackSearches: Record<string, unknown>[] = [
      {
        q: plan.zeroResultFallbackQuery,
        query_by: queryBy,
        query_by_weights: LEGAL_ENTITIES_QUERY_BY_WEIGHTS,
        per_page: perPage,
        filter_by: params.filterBy,
        typo_tolerance: true,
      },
      {
        q: plan.canonicalName,
        query_by: queryByExpanded,
        query_by_weights: LEGAL_ENTITIES_QUERY_BY_EXPANDED_WEIGHTS,
        per_page: perPage,
        filter_by: params.filterBy,
        typo_tolerance: true,
      },
    ];
    searches.push(...fallbackSearches);
    const retry = await performLegalEntitiesMultiSearch(fallbackSearches, params.limit);
    hits = retry.hits;
    degradedModes.push(...retry.degradedModes);
  }

  if (hits.length) degradedModes.push("vague_query_rescue");
  return {
    hits,
    degradedModes,
    typesenseQueries: searches,
    searchedFields: queryBy.split(","),
    fallbackTriggered,
  };
}

/** Standard directory search + taxonomy zero-hit retry when applicable. */
export async function searchWithTaxonomyRescue(args: {
  parsed: ParsedQuery;
  q: string;
  expandedQ: string;
  limit: number;
  filterBy?: string;
  geoSortLat?: number;
  geoSortLng?: number;
  locationQ?: string;
  vagueQueryMode: boolean;
  rescuePlan: VagueQueryRescuePlan | null;
}): Promise<VagueRescueSearchResult & { initialHitCount: number }> {
  const {
    parsed,
    q,
    expandedQ,
    limit,
    filterBy,
    geoSortLat,
    geoSortLng,
    locationQ,
    vagueQueryMode,
    rescuePlan,
  } = args;

  if (vagueQueryMode && rescuePlan) {
    const rescue = await searchVagueLegalEntitiesMulti(rescuePlan, {
      limit,
      filterBy,
      geoSortLat,
      geoSortLng,
      locationQ,
      includeZeroResultFallback: true,
    });
    return { ...rescue, initialHitCount: rescue.hits.length };
  }

  const standard = await searchLegalEntitiesMulti({
    q,
    expandedQ,
    limit,
    filterBy,
    geoSortLat,
    geoSortLng,
  });

  let hits = standard.hits;
  let typesenseQueries: Record<string, unknown>[] = [
    { q, expandedQ, filterBy, query_by: LEGAL_ENTITIES_QUERY_BY },
  ];
  let fallbackTriggered = false;
  const degradedModes = [...standard.degradedModes];

  if (shouldTriggerTaxonomyZeroResultRescue(parsed, hits.length) && rescuePlan) {
    fallbackTriggered = true;
    degradedModes.push("taxonomy_zero_result_fallback");
    const retry = await searchVagueLegalEntitiesMulti(rescuePlan, {
      limit: Math.max(limit, 60),
      filterBy: undefined,
      geoSortLat,
      geoSortLng,
      locationQ,
      includeZeroResultFallback: true,
    });
    hits = retry.hits;
    typesenseQueries = retry.typesenseQueries;
    degradedModes.push(...retry.degradedModes);
  }

  return {
    hits,
    degradedModes,
    typesenseQueries,
    searchedFields: LEGAL_ENTITIES_QUERY_BY.split(","),
    fallbackTriggered,
    initialHitCount: standard.hits.length,
  };
}

/** Enrich parsed query with vague-mode refinement copy (does not force clarify). */
export function applyVagueParsedQueryUx(parsed: ParsedQuery): ParsedQuery {
  if (!detectVagueLegalQuery(parsed)) return parsed;
  const plan = buildVagueQueryRescuePlan(parsed);
  const summary = buildVagueRefinementSummary(parsed, plan);
  const match = getTaxonomyMatch(parsed);
  const entry = match ? bySlug.get(match.slug) : null;
  const chips = entry
    ? refinementChipsFromEntry(entry)
    : refinementChipsFromHints(plan?.narrowHints ?? []);

  return {
    ...parsed,
    taxonomySummary: summary,
    refinementQuestion: null,
    refinementChips: chips.length > 0 ? chips : parsed.refinementChips,
  };
}

/** Re-resolve taxonomy from raw text when building a plan (eval / legacy). */
export function rescuePlanFromQueryText(raw: string, parsed: ParsedQuery): VagueQueryRescuePlan | null {
  const resolution = resolveLegalIssueFromQuery(raw);
  if (!resolution) return buildVagueQueryRescuePlan(parsed);
  const entry = bySlug.get(resolution.taxonomySlug);
  if (!entry) return buildVagueQueryRescuePlan(parsed);
  return buildVagueQueryRescuePlan({
    ...parsed,
    taxonomySlug: resolution.taxonomySlug,
    taxonomyPrimaryLabel: resolution.canonicalName,
    taxonomyRelatedLabels: resolution.relatedPracticeAreas,
  });
}
