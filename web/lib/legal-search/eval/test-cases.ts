/**
 * Lightweight regression strings for `npm run search:eval`.
 * Not a full offline benchmark — runs deterministic parsers + heuristics only.
 *
 * `expectPracticeHint` matches `ParsedQuery.practiceAreaSlug` after taxonomy→matcher mapping
 * (e.g. housing maps to the matcher bucket `family`).
 */

export const EVAL_QUERIES: {
  query: string;
  expectPracticeHint?: string;
}[] = [
  { query: "I was unfairly dismissed in London", expectPracticeHint: "employment" },
  { query: "immigration solicitor who speaks Urdu", expectPracticeHint: "immigration" },
  { query: "legal aid housing lawyer near Birmingham", expectPracticeHint: "family" },
  { query: "divorce solicitor fixed fee Manchester", expectPracticeHint: "family" },
  { query: "I was arrested and need urgent help", expectPracticeHint: "criminal_defence" },
  { query: "tenant eviction notice", expectPracticeHint: "family" },
  { query: "probate lawyer for my father's estate", expectPracticeHint: "family" },
  { query: "I need employment advice", expectPracticeHint: "employment" },
  { query: "help with immigration", expectPracticeHint: "immigration" },
  { query: "commercial contract dispute", expectPracticeHint: "commercial" },
  { query: "i need a prison lawyer", expectPracticeHint: "criminal_defence" },
];
