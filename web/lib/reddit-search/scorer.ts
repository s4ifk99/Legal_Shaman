import { openRouterJsonCompletion } from "./openrouter-client";
import type { RankedRedditResult, RankResultsResponse, RedditResult } from "./types";

const SCORER_SYSTEM_PROMPT = `You are a legal relevance scorer for Reddit discussions.

Score how relevant each Reddit post is to the user's legal information need.

Rules:
- relevanceScore must be between 0 and 1
- Prefer posts that discuss similar facts, legal issues, and jurisdiction (UK)
- Penalize off-topic, joke, or non-legal threads
- enough_good_results is true when at least 5 posts have relevanceScore >= 0.7
- whyRelevant should be one concise sentence

Return valid JSON only.`;

const HIGH_RELEVANCE_THRESHOLD = 0.7;
const MIN_HIGHLY_RELEVANT = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function fallbackRank(userQuery: string, results: RedditResult[]): RankResultsResponse {
  const maxScore = Math.max(1, ...results.map((r) => r.score));
  const ranked: RankedRedditResult[] = results.map((result) => {
    const relevanceScore = clampScore(result.score / maxScore);
    return {
      ...result,
      relevanceScore,
      whyRelevant: `Fallback rank by Reddit score for query: ${userQuery.slice(0, 120)}`,
    };
  });

  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const highlyRelevant = ranked.filter(
    (r) => r.relevanceScore >= HIGH_RELEVANCE_THRESHOLD,
  ).length;

  return {
    enough_good_results: highlyRelevant >= MIN_HIGHLY_RELEVANT,
    results: ranked,
  };
}

function parseScorerResponse(
  raw: unknown,
  sourceResults: RedditResult[],
): RankResultsResponse {
  if (!isRecord(raw)) {
    throw new Error("Scorer response was not a JSON object");
  }

  const byUrl = new Map(sourceResults.map((r) => [r.url, r]));
  const rawResults = Array.isArray(raw.results) ? raw.results : [];

  const ranked: RankedRedditResult[] = [];

  for (const item of rawResults) {
    if (!isRecord(item)) continue;

    const url = typeof item.url === "string" ? item.url.trim() : "";
    const base = byUrl.get(url);
    if (!base) continue;

    ranked.push({
      ...base,
      relevanceScore: clampScore(item.relevanceScore),
      whyRelevant:
        typeof item.whyRelevant === "string" && item.whyRelevant.trim()
          ? item.whyRelevant.trim()
          : "Relevant to the user's legal issue.",
    });
  }

  for (const result of sourceResults) {
    if (!ranked.some((r) => r.url === result.url)) {
      ranked.push({
        ...result,
        relevanceScore: 0,
        whyRelevant: "Not scored by the model.",
      });
    }
  }

  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const enoughFromModel =
    typeof raw.enough_good_results === "boolean" ? raw.enough_good_results : undefined;

  const highlyRelevant = ranked.filter(
    (r) => r.relevanceScore >= HIGH_RELEVANCE_THRESHOLD,
  ).length;

  return {
    enough_good_results:
      enoughFromModel ?? highlyRelevant >= MIN_HIGHLY_RELEVANT,
    results: ranked,
  };
}

/**
 * Score Reddit results for relevance to the user query using the configured LLM.
 */
export async function rankResults(
  userQuery: string,
  results: RedditResult[],
): Promise<RankResultsResponse> {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    throw new Error("userQuery must not be empty");
  }

  if (results.length === 0) {
    return {
      enough_good_results: false,
      results: [],
    };
  }

  const payload = results.map((r) => ({
    title: r.title,
    url: r.url,
    subreddit: r.subreddit,
    score: r.score,
    snippet: r.snippet,
  }));

  try {
    const raw = await openRouterJsonCompletion(
      SCORER_SYSTEM_PROMPT,
      `Return JSON with this shape:
{
  "enough_good_results": false,
  "results": [
    {
      "url": "",
      "relevanceScore": 0,
      "whyRelevant": ""
    }
  ]
}

User query:
${trimmed}

Posts to score:
${JSON.stringify(payload, null, 2)}`,
    );

    return parseScorerResponse(raw, results);
  } catch (err) {
    console.warn(
      "[reddit-search.scorer] LLM scoring failed, using fallback:",
      err instanceof Error ? err.message : err,
    );
    return fallbackRank(trimmed, results);
  }
}

/** Count results meeting the high-relevance threshold. */
export function countHighlyRelevant(results: RankedRedditResult[]): number {
  return results.filter((r) => r.relevanceScore >= HIGH_RELEVANCE_THRESHOLD).length;
}

export { HIGH_RELEVANCE_THRESHOLD, MIN_HIGHLY_RELEVANT };
