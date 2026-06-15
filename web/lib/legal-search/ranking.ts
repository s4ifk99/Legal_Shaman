import type { ParsedQuery, SearchResult, SearchResultScores } from "@/lib/legal-search/types";
import { textLocationScore } from "@/lib/legal-search/location";
import {
  applyBehaviouralBoostToFinal,
  computeBehaviouralBoostDelta,
  type RankingSignalLite,
} from "@/lib/search-events/behavioural-boost";
import { entityBoostKey } from "@/lib/search-events/types";
import {
  inferPracticeAreaSlugFromText,
  rowMatchesPracticeTaxonomySlug,
} from "@/lib/legal/taxonomy";
import {
  classifyTaxonomySignal,
  type VagueQueryRescuePlan,
} from "@/lib/legal-search/vague-query-rescue";
import {
  detectFundingIntent,
  fundingIntentBoostsLegalAid,
  type FundingIntent,
} from "@/lib/legal-search/funding-intent";

/** Tokens that inflate lexical overlap without adding intent (directory ranking). */
const DIRECTORY_KEYWORD_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "was",
  "one",
  "our",
  "out",
  "get",
  "has",
  "how",
  "new",
  "now",
  "see",
  "who",
  "way",
  "may",
  "she",
  "use",
  "any",
  "his",
  "her",
  "had",
  "have",
  "this",
  "that",
  "with",
  "from",
  "they",
  "been",
  "into",
  "than",
  "when",
  "what",
  "your",
  "will",
  "would",
  "could",
  "should",
  "about",
  "after",
  "also",
  "just",
  "more",
  "some",
  "very",
  "need",
  "want",
  "help",
  "find",
  "looking",
  "please",
  "hire",
  "good",
  "best",
  "cheap",
  "local",
  "near",
  "someone",
  "lawyer",
  "lawyers",
  "solicitor",
  "solicitors",
  "attorney",
  "firm",
  "legal",
  "advice",
  "law",
]);

const W = {
  keyword: 0.22,
  semantic: 0.18,
  location: 0.16,
  practiceArea: 0.14,
  jurisdiction: 0.06,
  language: 0.06,
  authority: 0.08,
  freshness: 0.05,
};

function sourceAuthorityForIntent(
  source: SearchResult["source"],
  intent: FundingIntent,
): number {
  if (fundingIntentBoostsLegalAid(intent)) {
    const legalAidFirst: Record<SearchResult["source"], number> = {
      legal_aid: 0.95,
      curated_listing: 0.88,
      lawyer: 0.86,
      firm: 0.84,
      sra: 0.8,
    };
    return legalAidFirst[source] ?? 0.75;
  }
  if (intent === "private") {
    const privateFirst: Record<SearchResult["source"], number> = {
      curated_listing: 0.96,
      lawyer: 0.94,
      firm: 0.92,
      sra: 0.9,
      legal_aid: 0.7,
    };
    return privateFirst[source] ?? 0.75;
  }
  const generic: Record<SearchResult["source"], number> = {
    curated_listing: 0.95,
    lawyer: 0.93,
    firm: 0.9,
    sra: 0.88,
    legal_aid: 0.76,
  };
  return generic[source] ?? 0.75;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Below this, directory explanations avoid claiming a strong "keyword match". */
export const DIRECTORY_KEYWORD_MATCH_STRONG = 0.22;

/**
 * Fill missing score components and compute weighted `final`.
 * Avoids rating-only dominance by capping rating contribution inside authority blend.
 */
export type RankSearchOptions = {
  behaviouralSignals?: Map<string, RankingSignalLite>;
  /** Broad taxonomy rescue: widen related areas, tighten authority + signal gating. */
  vagueQueryMode?: boolean;
  vagueRescuePlan?: VagueQueryRescuePlan;
};

function profileCompletenessScore(r: SearchResult): number {
  let s = 0;
  if (r.description && r.description.length > 40) s += 0.2;
  if (r.practiceAreas.length > 0) s += 0.2;
  if (r.location?.city) s += 0.15;
  if (r.contact?.phone || r.contact?.website) s += 0.1;
  if (r.rating != null && r.rating > 0) s += 0.15;
  if (r.verified) s += 0.2;
  return clamp01(s);
}

export function rankSearchResults(
  results: SearchResult[],
  parsed: ParsedQuery,
  opts?: RankSearchOptions,
): SearchResult[] {
  const q = parsed.semanticQuery.toLowerCase();
  const qSlug = parsed.practiceAreaSlug?.toLowerCase();
  const qCity = parsed.location?.toLowerCase();
  const qPost = parsed.postcode?.replace(/\s+/g, "").toUpperCase();
  const vagueMode = Boolean(opts?.vagueQueryMode && opts.vagueRescuePlan);
  const fundingIntent = parsed.fundingIntent ?? detectFundingIntent(parsed.semanticQuery);
  const boostLegalAidAuthority = fundingIntentBoostsLegalAid(fundingIntent);

  return results.map((r) => {
    const scores = { ...r.scores };
    const title = r.title.toLowerCase();
    const desc = (r.description ?? "").toLowerCase();
    const blob = `${title} ${desc}`;
    const hayKeywords = `${blob} ${r.practiceAreas.join(" ")} ${(r.categories ?? []).join(" ")}`;
    const hayFull = `${hayKeywords} ${(parsed.expandedSearchText ?? "").toLowerCase()}`;

    const meaningfulTokens = q
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9']/gi, "").toLowerCase())
      .filter((t) => t.length > 2 && !DIRECTORY_KEYWORD_STOPWORDS.has(t));
    const denom = Math.max(3, meaningfulTokens.length);
    const kwHits = meaningfulTokens.filter((t) => hayKeywords.includes(t)).length;
    scores.keyword = clamp01(meaningfulTokens.length === 0 ? 0 : kwHits / denom);

    scores.semantic = scores.semantic > 0 ? scores.semantic : scores.keyword * 0.85;

    scores.location = textLocationScore({
      queryCity: qCity,
      queryPostcode: qPost,
      resultCity: r.location?.city ?? "",
      resultPostcode: r.location?.postcode ?? "",
    });

    const inferredFromListing = inferPracticeAreaSlugFromText(blob);
    const inferredFromQuery = inferPracticeAreaSlugFromText(q);
    const effectiveSlug = (inferredFromQuery ?? qSlug)?.toLowerCase() ?? null;

    if (vagueMode && opts?.vagueRescuePlan) {
      const signal = classifyTaxonomySignal(r, opts.vagueRescuePlan);
      if (signal === "canonical" || signal === "alias" || signal === "subissue") {
        scores.practiceArea = 1;
      } else if (signal === "related" || signal === "legal_aid" || signal === "category") {
        scores.practiceArea = 0.78;
      } else {
        scores.practiceArea = 0.05;
      }
    } else if (effectiveSlug) {
      const rowAligned = rowMatchesPracticeTaxonomySlug(effectiveSlug, hayFull);
      const slugMatchesLabel = r.practiceAreas.some(
        (p) =>
          p.toLowerCase().includes(effectiveSlug.replace(/_/g, " ")) ||
          effectiveSlug.replace(/_/g, " ").includes(p.toLowerCase()),
      );
      if (rowAligned || slugMatchesLabel) {
        scores.practiceArea = 1;
      } else if (inferredFromListing === effectiveSlug) {
        scores.practiceArea = 0.72;
      } else {
        scores.practiceArea = 0.1;
      }
    } else if (inferredFromListing) {
      scores.practiceArea = 0.55;
    } else {
      scores.practiceArea = 0.45;
    }

    scores.jurisdiction = parsed.jurisdiction
      ? r.jurisdictions?.some((j) => j.includes(parsed.jurisdiction!))
        ? 1
        : 0.3
      : 0.5;

    const wantLang = parsed.languagePreference?.[0]?.toLowerCase();
    scores.language = wantLang
      ? r.languages?.some((l) => l.toLowerCase().includes(wantLang))
        ? 1
        : 0.25
      : 0.5;

    const baseAuth = sourceAuthorityForIntent(r.source, fundingIntent);
    const verifiedBoost = r.verified ? 0.08 : 0;
    const ratingCap = r.rating != null ? clamp01(r.rating / 5) * 0.15 : 0;
    const profileBoost = vagueMode ? profileCompletenessScore(r) * 0.12 : 0;
    const legalAidBoost =
      boostLegalAidAuthority && r.source === "legal_aid"
        ? 0.05
        : vagueMode && opts?.vagueRescuePlan?.legalAidLikely && r.source === "legal_aid"
          ? 0.04
          : 0;
    scores.authority = clamp01(baseAuth + verifiedBoost + ratingCap + profileBoost + legalAidBoost);

    scores.freshness = 0.5;

    const baseFinal = clamp01(
      W.keyword * scores.keyword +
        W.semantic * scores.semantic +
        W.location * scores.location +
        W.practiceArea * scores.practiceArea +
        W.jurisdiction * scores.jurisdiction +
        W.language * scores.language +
        W.authority * scores.authority +
        W.freshness * scores.freshness,
    );

    const signal = opts?.behaviouralSignals?.get(entityBoostKey(r.source, r.id));
    const boostDelta = computeBehaviouralBoostDelta(baseFinal, signal, {
      practiceArea: scores.practiceArea,
      keyword: scores.keyword,
    });
    let finalScore = applyBehaviouralBoostToFinal(baseFinal, boostDelta);
    if (vagueMode && opts?.vagueRescuePlan) {
      const signal = classifyTaxonomySignal(r, opts.vagueRescuePlan);
      if (signal === "none") finalScore = clamp01(finalScore * 0.35);
    }

    const indexQ = (r.raw as { indexQualityScore?: number } | null)?.indexQualityScore;
    const completeness = (r.raw as { providerCompletenessScore?: number } | null)
      ?.providerCompletenessScore;
    if (
      typeof indexQ === "number" &&
      indexQ >= 0.72 &&
      scores.practiceArea >= 0.45 &&
      scores.keyword >= DIRECTORY_KEYWORD_MATCH_STRONG
    ) {
      finalScore = clamp01(finalScore + 0.02 * indexQ);
    }
    if (
      typeof completeness === "number" &&
      completeness >= 0.55 &&
      completeness < 0.85 &&
      scores.practiceArea >= 0.45 &&
      scores.keyword >= DIRECTORY_KEYWORD_MATCH_STRONG
    ) {
      finalScore = clamp01(finalScore + 0.015 * completeness);
    }

    scores.final = finalScore;

    return { ...r, scores };
  });
}

export function sortByFinalScore(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => b.scores.final - a.scores.final);
}

export function emptyScores(partial: Partial<SearchResultScores> = {}): SearchResultScores {
  return {
    keyword: partial.keyword ?? 0,
    semantic: partial.semantic ?? 0,
    location: partial.location ?? 0,
    practiceArea: partial.practiceArea ?? 0,
    jurisdiction: partial.jurisdiction ?? 0,
    language: partial.language ?? 0,
    authority: partial.authority ?? 0,
    freshness: partial.freshness ?? 0,
    reranker: partial.reranker,
    final: partial.final ?? 0,
  };
}
