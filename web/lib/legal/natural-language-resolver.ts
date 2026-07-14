/**
 * Natural-language legal issue resolution: phrase index, lawyer-intent patterns,
 * and weighted taxonomy scoring.
 */

import {
  LEGAL_ISSUE_TAXONOMY,
  type LegalIssueTaxonomyEntry,
} from "@/lib/legal/legal-issue-taxonomy-data";
import { inferSubIssueFromTaxonomy } from "@/lib/legal/sub-issue-rules";
import {
  normalizePhrase,
  normalizePracticeAreas,
  singularizePhrase,
} from "@/lib/provider-crawler/practice-area-normalizer";

export type NaturalLanguageIssueResolution = {
  taxonomySlug: string;
  canonicalName: string;
  matcherSlug: string;
  relatedPracticeAreas: string[];
  expandedTerms: string[];
  clarificationQuestion: string | null;
  searchBoostTerms: string[];
  legalAidLikely: boolean;
  matchStrength: number;
};

const byTaxonomySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));

function uniqueLower(strings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of strings) {
    const t = s.trim().toLowerCase();
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function relaxContractions(s: string): string {
  return s.replace(/'/g, "").replace(/’/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Prefer whole-word matches for short phrases; allow substring for longer phrases. */
function phraseMatchesText(phrase: string, text: string): boolean {
  if (phrase.length < 2 || !text.includes(phrase)) return false;
  if (phrase.length >= 5) return true;
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(phrase)}(?:[^a-z0-9]|$)`, "i");
  return re.test(text);
}

function phrasesForEntry(e: LegalIssueTaxonomyEntry): string[] {
  return uniqueLower([
    ...e.aliases,
    ...e.userPhrases,
    ...e.subIssues,
    ...e.searchBoostTerms,
    e.canonicalName,
    e.slug.replace(/_/g, " "),
  ]).sort((a, b) => b.length - a.length);
}

const phraseLists = new Map(
  LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, phrasesForEntry(e)] as const),
);

const GENERIC_PROFESSION_WORDS = new Set([
  "solicitor",
  "solicitors",
  "lawyer",
  "lawyers",
  "barrister",
  "barristers",
  "conveyancer",
  "conveyancers",
  "attorney",
  "legal",
  "adviser",
  "advisor",
  "need",
  "find",
  "looking",
  "want",
  "help",
  "good",
  "best",
  "local",
  "near",
  "me",
]);

/** Extract practice-area phrases from "X solicitor" / "solicitor for X" patterns. */
function extractLawyerIntentPhrases(raw: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b([\w][\w\s/-]{2,56}?)\s+(?:solicitor|solicitors|lawyer|lawyers|barrister|barristers|conveyancer|conveyancers)\b/gi,
    /\b(?:solicitor|lawyer|barrister|conveyancer)\s+(?:for|specialising in|specializing in|in)\s+([\w][\w\s/-]{2,56}?)(?:\s|$|[,.])/gi,
    /\b(?:need|find|want|looking for)\s+(?:a\s+)?([\w][\w\s/-]{2,48}?)\s+(?:solicitor|lawyer|barrister)\b/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const chunk = m[1]?.trim();
      if (!chunk || chunk.length < 3) continue;
      const words = chunk
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1 && !GENERIC_PROFESSION_WORDS.has(w));
      if (words.length === 0) continue;
      out.push(words.join(" "));
      out.push(chunk.toLowerCase());
    }
  }

  return uniqueLower(out);
}

type ScoredCandidate = { entry: LegalIssueTaxonomyEntry; score: number };

function scoreEntryAgainstText(entry: LegalIssueTaxonomyEntry, lower: string): number {
  const phrases = phraseLists.get(entry.slug) ?? [];
  let score = 0;

  for (const ph of phrases) {
    if (ph.length < 3) continue;
    if (/^(solicitor|lawyers?|attorney)s?$/.test(ph)) continue;
    if (phraseMatchesText(ph, lower)) score += ph.length;
  }

  for (const sig of entry.emergencySignals) {
    const s = sig.toLowerCase();
    if (s.length >= 3 && phraseMatchesText(s, lower)) score += s.length * 1.2;
  }

  return score;
}

function resolutionFromEntry(
  entry: LegalIssueTaxonomyEntry,
  score: number,
): NaturalLanguageIssueResolution {
  const expandedTerms = uniqueLower([
    ...entry.searchBoostTerms,
    ...entry.subIssues,
    ...entry.relatedPracticeAreas,
    entry.canonicalName,
  ]);

  return {
    taxonomySlug: entry.slug,
    canonicalName: entry.canonicalName,
    matcherSlug: entry.matcherSlug,
    relatedPracticeAreas: entry.relatedPracticeAreas,
    expandedTerms,
    clarificationQuestion: entry.clarificationQuestions[0] ?? null,
    searchBoostTerms: entry.searchBoostTerms,
    legalAidLikely: entry.legalAidLikely,
    matchStrength: Math.min(1, score / 48),
  };
}

function mergeCandidates(candidates: ScoredCandidate[]): ScoredCandidate | null {
  const bySlug = new Map<string, number>();
  for (const c of candidates) {
    bySlug.set(c.entry.slug, (bySlug.get(c.entry.slug) ?? 0) + c.score);
  }
  let best: ScoredCandidate | null = null;
  for (const [slug, score] of bySlug) {
    if (score <= 0) continue;
    const entry = byTaxonomySlug.get(slug);
    if (!entry) continue;
    if (!best || score > best.score) best = { entry, score };
  }

  if (best?.entry.slug === "consumer") {
    for (const [slug, score] of bySlug) {
      if (!slug.startsWith("consumer_") || score < best.score * 0.85) continue;
      const entry = byTaxonomySlug.get(slug);
      if (entry && score >= (best?.score ?? 0)) best = { entry, score };
    }
  }

  return best;
}

/**
 * Resolve the best-matching legal issue from free-text natural language.
 * Combines taxonomy phrase scoring, phrase-index normalisation, and lawyer-intent patterns.
 */
export function resolveLegalIssueFromNaturalLanguage(
  raw: string,
): NaturalLanguageIssueResolution | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return null;

  const lower = normalizePhrase(trimmed);
  const singular = singularizePhrase(lower);
  const relaxed = relaxContractions(lower);
  const texts = uniqueLower([lower, singular, relaxed, trimmed.toLowerCase()]);
  const candidates: ScoredCandidate[] = [];

  for (const entry of LEGAL_ISSUE_TAXONOMY) {
    let score = 0;
    for (const t of texts) {
      score = Math.max(score, scoreEntryAgainstText(entry, t));
    }
    if (score > 0) candidates.push({ entry, score });
  }

  const normalized = normalizePracticeAreas(trimmed);
  for (const slug of normalized.canonicalSlugs) {
    const entry = byTaxonomySlug.get(slug);
    if (!entry) continue;
    if (normalized.taxonomyConfidence < 0.62) continue;
    const boost = 12 + normalized.taxonomyConfidence * 24;
    candidates.push({ entry, score: boost });
  }

  for (const phrase of extractLawyerIntentPhrases(trimmed)) {
    const segment = normalizePracticeAreas(phrase);
    for (const slug of segment.canonicalSlugs) {
      const entry = byTaxonomySlug.get(slug);
      if (!entry) continue;
      if (segment.taxonomyConfidence < 0.62) continue;
      candidates.push({ entry, score: 24 + segment.taxonomyConfidence * 18 });
    }
    const direct = LEGAL_ISSUE_TAXONOMY.find((e) => {
      const slugPhrase = e.slug.replace(/_/g, " ");
      return phrase === slugPhrase || phrase.includes(slugPhrase) || slugPhrase.includes(phrase);
    });
    if (direct) candidates.push({ entry: direct, score: 26 });
  }

  if (inferSubIssueFromTaxonomy(trimmed, "employment")) {
    const employment = byTaxonomySlug.get("employment");
    if (employment) candidates.push({ entry: employment, score: 44 });
  }

  const best = mergeCandidates(candidates);
  if (!best) return null;

  if (
    (lower.includes("judicial review") || /\bjr\b/.test(lower)) &&
    byTaxonomySlug.has("judicial_review")
  ) {
    return resolutionFromEntry(byTaxonomySlug.get("judicial_review")!, best.score);
  }

  return resolutionFromEntry(best.entry, best.score);
}

/** All taxonomy slugs for prompts and validation. */
export function allTaxonomySlugs(): string[] {
  return LEGAL_ISSUE_TAXONOMY.map((e) => e.slug);
}
