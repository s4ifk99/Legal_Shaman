import {
  resolveLegalIssueFromQuery,
  type LegalIssueResolution,
} from "@/lib/legal/taxonomy";

const PARKING_QUERY =
  /\b(parking|pcn|penalty charge notice|penalty charge|council fine|parking ticket|motoring|speeding|traffic regulation|decriminalised parking|civil parking)\b/i;

const PARKING_SIGNAL =
  /\b(pcn|penalty charge|parking fines?|council parking|parking tickets?|private parking|parking appeals?|traffic (management|regulation)|double yellow|permit zone|decriminalised|civil parking enforcement)\b/i;

const PARKING_NOISE =
  /\b(storage parking|new build|extending|planning permission|developer|garage conversion)\b/i;

const SEARCH_STOPWORDS = new Set([
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
  "firms",
  "legal",
  "advice",
  "law",
  "uk",
  "england",
  "wales",
]);

function uniqueTerms(terms: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const t = raw.trim().toLowerCase();
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Terms used to score whether a Reddit thread matches the user's issue. */
export function oslawRelevanceTerms(raw: string): string[] {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const resolution = resolveLegalIssueFromQuery(trimmed);
  const terms: string[] = [];

  for (const word of lower.split(/[^a-z0-9]+/)) {
    if (word.length >= 3 && !SEARCH_STOPWORDS.has(word)) terms.push(word);
  }

  if (resolution) {
    terms.push(resolution.canonicalName.toLowerCase());
    for (const phrase of [
      ...resolution.searchBoostTerms.slice(0, 4),
      ...resolution.expandedTerms.slice(0, 6),
      ...resolution.relatedPracticeAreas.slice(0, 3),
    ]) {
      for (const part of phrase.toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length >= 3 && !SEARCH_STOPWORDS.has(part)) terms.push(part);
      }
      if (phrase.length >= 4 && phrase.length <= 40) terms.push(phrase.toLowerCase());
    }
  }

  return uniqueTerms(terms);
}

function extractRedditKeywordQuery(
  raw: string,
  resolution: LegalIssueResolution | null,
): string | null {
  const words = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !SEARCH_STOPWORDS.has(w));

  const picked: string[] = [...words.slice(0, 4)];

  if (resolution) {
    for (const boost of resolution.searchBoostTerms.slice(0, 2)) {
      for (const part of boost.toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length >= 4 && !SEARCH_STOPWORDS.has(part)) picked.push(part);
      }
    }
    const slugPhrase = resolution.taxonomySlug.replace(/_/g, " ");
    if (slugPhrase.length >= 4) picked.push(slugPhrase);
  }

  const query = uniqueTerms(picked).slice(0, 6).join(" ");
  return query.length >= 2 ? query : null;
}

/** Build Reddit search strings — short keyword queries work better than full sentences. */
export function buildOslawSearchQueryVariants(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return [];

  const lower = trimmed.toLowerCase();
  const resolution = resolveLegalIssueFromQuery(trimmed);
  const variants: string[] = [];

  const keywordQuery = extractRedditKeywordQuery(trimmed, resolution);
  if (keywordQuery) variants.push(keywordQuery);

  if (!variants.some((v) => v.toLowerCase() === lower)) {
    variants.push(trimmed);
  }

  if (resolution?.taxonomySlug === "parking_pcn" || PARKING_QUERY.test(trimmed)) {
    if (!/\bpcn\b/i.test(lower)) variants.push("parking PCN council fine appeal");
    if (/regulation/i.test(lower) && !/ticket|fine|pcn/i.test(lower)) {
      variants.push("parking regulations council PCN");
    }
    if (/private parking/i.test(lower)) variants.push("private parking charge appeal");
  } else if (resolution) {
    const boost = resolution.searchBoostTerms.find(
      (term) => term.length >= 4 && !lower.includes(term.toLowerCase()),
    );
    if (boost) variants.push(boost);

    const canonical = resolution.canonicalName.trim();
    if (canonical.length >= 4 && !lower.includes(canonical.toLowerCase())) {
      variants.push(canonical);
    }
  }

  return [...new Set(variants.map((v) => v.trim()).filter((v) => v.length >= 2))].slice(0, 3);
}

/** Boost on-topic parking / regulatory threads and down-rank obvious noise. */
export function topicalRelevanceBoost(query: string, title: string, snippet = ""): number {
  const text = `${title} ${snippet}`.toLowerCase();
  const q = query.toLowerCase();
  let boost = 0;

  if (PARKING_QUERY.test(q) || resolveLegalIssueFromQuery(query)?.taxonomySlug === "parking_pcn") {
    if (PARKING_SIGNAL.test(text)) boost += 18;
    if (PARKING_NOISE.test(text) && !PARKING_SIGNAL.test(text)) boost -= 14;
    if (!/\bparking\b/i.test(text) && !PARKING_SIGNAL.test(text)) boost -= 10;
    if (
      /\bregulation/i.test(q) &&
      /\b(council|local authority|traffic|enforcement|permit|tmo|parking)\b/i.test(text)
    ) {
      boost += 8;
    }
  }

  return boost;
}

/** Score how well a Reddit post matches the user's search issue (higher = more relevant). */
export function scoreOslawResultRelevance(query: string, title: string, snippet = ""): number {
  const text = `${title} ${snippet}`.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  let score = topicalRelevanceBoost(query, title, snippet);
  const terms = oslawRelevanceTerms(query);
  let matchedDistinct = 0;

  for (const term of terms) {
    if (term.length < 3) continue;
    if (!text.includes(term)) continue;
    matchedDistinct++;
    if (term.length >= 10) score += 14;
    else if (term.length >= 6) score += 10;
    else score += 6;
  }

  if (q.length >= 5 && text.includes(q)) score += 30;

  const rawWords = q
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !SEARCH_STOPWORDS.has(w));
  const rawHits = rawWords.filter((w) => text.includes(w)).length;
  if (rawHits >= 2) score += rawHits * 5;
  else if (rawHits === 0 && rawWords.length >= 2) score -= 25;
  else if (rawHits === 1) score += 3;

  if (matchedDistinct === 0 && rawHits === 0) score -= 20;

  return score;
}

export type OslawScoredResult<T> = { row: T; relevance: number };

/** Sort by topical match first; drop threads with no meaningful overlap when possible. */
export function rankAndFilterOslawResults<T extends { title: string; snippet?: string; score: number; comments: number }>(
  query: string,
  results: T[],
  limit: number,
): T[] {
  if (!results.length) return [];

  const scored: OslawScoredResult<T>[] = results.map((row) => ({
    row,
    relevance: scoreOslawResultRelevance(query, row.title, row.snippet ?? ""),
  }));

  scored.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    const engA = Math.log1p(a.row.score) * 2 + Math.log1p(a.row.comments);
    const engB = Math.log1p(b.row.score) * 2 + Math.log1p(b.row.comments);
    return engB - engA;
  });

  const MIN_RELEVANCE = 6;
  const strong = scored.filter((s) => s.relevance >= MIN_RELEVANCE);
  const pool = strong.length >= Math.min(3, limit) ? strong : scored;
  return pool.slice(0, limit).map((s) => s.row);
}

export function hasStrongOslawMatches(
  query: string,
  results: Array<{ title: string; snippet?: string }>,
  minCount = 3,
): boolean {
  const strong = results.filter(
    (row) => scoreOslawResultRelevance(query, row.title, row.snippet ?? "") >= 6,
  );
  return strong.length >= minCount;
}
