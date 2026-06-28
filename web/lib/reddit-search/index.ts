import { generateQueries, generateRefinedQueries } from "./planner";
import { rankResults, countHighlyRelevant, MIN_HIGHLY_RELEVANT } from "./scorer";
import { searchReddit } from "./search";
import type {
  RankedRedditResult,
  RedditAgentSearchResult,
  RedditResult,
} from "./types";

const MAX_ROUNDS = 2;
const QUERIES_PER_ROUND = 5;
const TOP_RESULTS = 10;

function mergeResults(existing: RedditResult[], incoming: RedditResult[]): RedditResult[] {
  const byUrl = new Map<string, RedditResult>();

  for (const result of [...existing, ...incoming]) {
    const current = byUrl.get(result.url);
    if (!current || result.score > current.score) {
      byUrl.set(result.url, result);
    }
  }

  return [...byUrl.values()];
}

function mergeRanked(
  existing: RankedRedditResult[],
  incoming: RankedRedditResult[],
): RankedRedditResult[] {
  const byUrl = new Map<string, RankedRedditResult>();

  for (const result of [...existing, ...incoming]) {
    const current = byUrl.get(result.url);
    if (!current || result.relevanceScore > current.relevanceScore) {
      byUrl.set(result.url, result);
    }
  }

  return [...byUrl.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Run the Reddit-only agentic search workflow:
 * plan → search → score, with optional second-round query refinement.
 */
export async function redditAgentSearch(
  userQuery: string,
): Promise<RedditAgentSearchResult> {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    throw new Error("userQuery must not be empty");
  }

  let roundsUsed = 0;
  let plan = await generateQueries(trimmed);
  let collected: RedditResult[] = [];
  let ranked: RankedRedditResult[] = [];
  let enoughGoodResults = false;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    roundsUsed = round;

    const queries = plan.search_queries.slice(0, QUERIES_PER_ROUND);
    const roundResults = await searchReddit(queries);
    collected = mergeResults(collected, roundResults);

    const scored = await rankResults(trimmed, collected);
    ranked = mergeRanked(ranked, scored.results);
    enoughGoodResults = scored.enough_good_results;

    const highlyRelevant = countHighlyRelevant(ranked);
    if (highlyRelevant >= MIN_HIGHLY_RELEVANT || round >= MAX_ROUNDS) {
      break;
    }

    plan = await generateRefinedQueries(trimmed, plan, collected);
  }

  return {
    legal_area: plan.legal_area,
    issue_summary: plan.issue_summary,
    enough_good_results: enoughGoodResults || countHighlyRelevant(ranked) >= MIN_HIGHLY_RELEVANT,
    rounds_used: roundsUsed,
    results: ranked.slice(0, TOP_RESULTS),
  };
}

export { generateQueries, generateRefinedQueries } from "./planner";
export { searchReddit, RedditSearchError } from "./search";
export { getRedditAccessToken, hasRedditOAuthCredentials } from "./oauth";
export { rankResults, countHighlyRelevant } from "./scorer";
export { OpenRouterError } from "./openrouter-client";
export type {
  RankedRedditResult,
  RankResultsResponse,
  RedditAgentSearchResult,
  RedditResult,
  SearchPlan,
} from "./types";
