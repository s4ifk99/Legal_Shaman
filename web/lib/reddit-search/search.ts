import { REDDIT_USER_AGENT } from "./public-fetch";
import {
  clearRedditTokenCache,
  getRedditAccessToken,
  hasRedditOAuthCredentials,
  RedditSearchError,
} from "./oauth";
import type {
  RedditListingChild,
  RedditResult,
  RedditSearchListing,
} from "./types";

const DEFAULT_SUBREDDIT = "LegalAdviceUK";
const SEARCH_LIMIT = 10;
const USER_AGENT = REDDIT_USER_AGENT;

export { RedditSearchError };

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    let path = parsed.pathname.replace(/\/+$/, "");
    if (path.endsWith("/")) path = path.slice(0, -1);
    parsed.pathname = path || "/";
    return parsed.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function buildPostUrl(child: RedditListingChild, subreddit: string): string {
  const permalink = child.data?.permalink?.trim();
  if (permalink) {
    return permalink.startsWith("http")
      ? permalink
      : `https://www.reddit.com${permalink}`;
  }

  const rawUrl = child.data?.url?.trim();
  if (rawUrl?.startsWith("http")) return rawUrl;

  return `https://www.reddit.com/r/${subreddit}/`;
}

function buildSnippet(selftext: string | undefined): string {
  const text = (selftext ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function mapListingChild(child: RedditListingChild, subreddit: string): RedditResult | null {
  const data = child.data;
  if (!data?.title?.trim()) return null;

  return {
    id: data.id?.trim() || buildPostUrl(child, subreddit),
    title: data.title.trim(),
    url: buildPostUrl(child, subreddit),
    subreddit: (data.subreddit ?? subreddit).trim(),
    score: typeof data.score === "number" ? data.score : 0,
    numComments: typeof data.num_comments === "number" ? data.num_comments : 0,
    createdUtc: typeof data.created_utc === "number" ? data.created_utc : 0,
    snippet: buildSnippet(data.selftext),
  };
}

/**
 * Execute a single subreddit search query.
 */
async function searchSingleQuery(
  accessToken: string,
  query: string,
  subreddit: string,
  limit = SEARCH_LIMIT,
): Promise<RedditResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = new URL(`https://oauth.reddit.com/r/${subreddit}/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("limit", String(limit));

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": USER_AGENT,
      },
    });
  } catch (err) {
    throw new RedditSearchError(
      `Reddit search request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (response.status === 401) {
    clearRedditTokenCache();
    throw new RedditSearchError("Reddit access token expired or invalid");
  }

  if (!response.ok) {
    const body = await response.text();
    throw new RedditSearchError(
      `Reddit search HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const listing = (await response.json()) as RedditSearchListing;
  const children = listing.data?.children ?? [];

  return children
    .map((child) => mapListingChild(child, subreddit))
    .filter((item): item is RedditResult => item !== null);
}

/** Search a single subreddit via OAuth. */
export async function searchRedditInSubreddit(
  query: string,
  subreddit: string,
  limit = SEARCH_LIMIT,
): Promise<RedditResult[]> {
  const accessToken = await getRedditAccessToken();
  try {
    return await searchSingleQuery(accessToken, query, subreddit, limit);
  } catch (err) {
    if (err instanceof RedditSearchError && err.message.includes("expired")) {
      const refreshed = await getRedditAccessToken();
      return await searchSingleQuery(refreshed, query, subreddit, limit);
    }
    throw err;
  }
}

/**
 * Search Reddit for each query, returning deduplicated normalized results.
 */
export async function searchReddit(queries: string[]): Promise<RedditResult[]> {
  if (!Array.isArray(queries) || queries.length === 0) {
    return [];
  }

  const accessToken = await getRedditAccessToken();
  const byUrl = new Map<string, RedditResult>();

  for (const query of queries) {
    let results: RedditResult[];
    try {
      results = await searchSingleQuery(accessToken, query, DEFAULT_SUBREDDIT);
    } catch (err) {
      if (err instanceof RedditSearchError && err.message.includes("expired")) {
        const refreshed = await getRedditAccessToken();
        results = await searchSingleQuery(refreshed, query, DEFAULT_SUBREDDIT);
      } else {
        throw err;
      }
    }

    for (const result of results) {
      const key = normalizeUrl(result.url);
      const existing = byUrl.get(key);
      if (!existing || result.score > existing.score) {
        byUrl.set(key, result);
      }
    }
  }

  return [...byUrl.values()];
}
