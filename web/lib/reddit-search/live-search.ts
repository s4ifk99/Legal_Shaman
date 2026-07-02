import { listOslawSearchSubredditNames } from "@/lib/oslaw/config";
import {
  buildOslawSearchQueryVariants,
  hasStrongOslawMatches,
  rankAndFilterOslawResults,
} from "@/lib/oslaw/search-queries";
import { hasRedditOAuthCredentials } from "./oauth";
import { searchRedditInSubreddit } from "./search";
import { fetchRedditPublic } from "./public-fetch";
import { fetchSubredditHotRss, searchSubredditRss } from "./rss";
import type { LiveRedditSearchResult, LiveSearchSource } from "./types";

export type { LiveRedditSearchResult, LiveSearchSource };

const FETCH_TIMEOUT_MS = 12_000;

type RedditApiListing = {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        title?: string;
        permalink?: string;
        subreddit?: string;
        subreddit_name_prefixed?: string;
        score?: number;
        num_comments?: number;
        created_utc?: number;
        selftext?: string;
      };
    }>;
  };
};

function buildSnippet(selftext: string | undefined): string {
  const text = (selftext ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function mapListing(payload: RedditApiListing, fallbackSubreddit: string): LiveRedditSearchResult[] {
  return (payload.data?.children ?? [])
    .map((child) => child.data)
    .filter((post) => post?.title?.trim())
    .map((post) => {
      const subName = post!.subreddit?.trim() || fallbackSubreddit;
      const permalink = post!.permalink?.trim();
      const url = permalink
        ? permalink.startsWith("http")
          ? permalink
          : `https://www.reddit.com${permalink}`
        : `https://www.reddit.com/r/${subName}/`;

      return {
        id: post!.id?.trim() || url,
        title: post!.title!.trim(),
        url,
        subreddit: post!.subreddit_name_prefixed ?? `r/${subName}`,
        score: post!.score ?? 0,
        comments: post!.num_comments ?? 0,
        snippet: buildSnippet(post!.selftext),
        createdUtc: post!.created_utc ?? 0,
      };
    });
}

async function searchPublicInSubreddit(
  query: string,
  subreddit: string,
  limit: number,
): Promise<LiveRedditSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    sort: "relevance",
    t: "all",
    limit: String(Math.min(25, Math.max(1, limit))),
  });
  const response = await fetchRedditPublic(
    `/r/${subreddit}/search.json?${params}`,
    FETCH_TIMEOUT_MS,
  );
  const payload = (await response.json()) as RedditApiListing;
  return mapListing(payload, subreddit);
}

function dedupeResults(results: LiveRedditSearchResult[]): LiveRedditSearchResult[] {
  const byKey = new Map<string, LiveRedditSearchResult>();
  for (const row of results) {
    const key = row.id || row.url;
    const existing = byKey.get(key);
    if (!existing || row.score > existing.score) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

const SEARCH_SUB_BATCH_SIZE = 2;
const SEARCH_SUB_BATCH_DELAY_MS = 400;
const SEARCH_VARIANT_DELAY_MS = 500;

function hasEnoughRelevantResults(
  query: string,
  results: LiveRedditSearchResult[],
  limit: number,
): boolean {
  if (results.length >= limit) return true;
  const minCount = Math.min(5, Math.max(3, Math.ceil(limit / 2)));
  if (results.length < minCount) return false;
  const strong = hasStrongOslawMatches(query, results, Math.min(3, minCount));
  return strong;
}

async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const rows = await Promise.all(chunk.map(fn));
    out.push(...rows);
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_SUB_BATCH_DELAY_MS));
    }
  }
  return out;
}

/**
 * Live search across OSLAW subreddits.
 * Order: OAuth (if configured) → Reddit RSS (no API app) → public JSON.
 */
export async function fetchLiveRedditSearch(
  query: string,
  limit = 12,
): Promise<{ results: LiveRedditSearchResult[]; source: LiveSearchSource }> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { results: [], source: "rss" };

  const searchSubs = listOslawSearchSubredditNames();
  const queryVariants = buildOslawSearchQueryVariants(trimmed);
  const perSub = Math.min(15, Math.ceil(limit / 2) + 4);
  const errors: string[] = [];

  async function collectForSource(
    searchFn: (sub: string, q: string) => Promise<LiveRedditSearchResult[]>,
    label: LiveSearchSource,
  ): Promise<{ results: LiveRedditSearchResult[]; source: LiveSearchSource } | null> {
    let merged: LiveRedditSearchResult[] = [];

    for (let i = 0; i < queryVariants.length; i++) {
      const variant = queryVariants[i]!;
      if (i > 0) {
        if (hasEnoughRelevantResults(trimmed, merged, limit)) break;
        await new Promise((resolve) => setTimeout(resolve, SEARCH_VARIANT_DELAY_MS));
      }

      const batches = await mapInBatches(searchSubs, SEARCH_SUB_BATCH_SIZE, async (sub) => {
        try {
          return await searchFn(sub, variant);
        } catch (err) {
          errors.push(
            `${label}:${sub}:${variant}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }
      });
      merged = dedupeResults([...merged, ...batches.flat()]);
      if (merged.length >= limit) break;
    }

    if (!merged.length) return null;
    return {
      results: rankAndFilterOslawResults(trimmed, merged, limit),
      source: label,
    };
  }

  if (hasRedditOAuthCredentials()) {
    try {
      const oauth = await collectForSource(
        (sub, q) =>
          searchRedditInSubreddit(q, sub, perSub).then((rows) =>
            rows.map((post) => ({
              id: post.id,
              title: post.title,
              url: post.url,
              subreddit: `r/${post.subreddit}`,
              score: post.score,
              comments: post.numComments,
              snippet: post.snippet,
              createdUtc: post.createdUtc,
            })),
          ),
        "oauth",
      );
      if (oauth) return oauth;
    } catch (err) {
      errors.push(`oauth: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const rss = await collectForSource(
      (sub, q) => searchSubredditRss(sub, q, perSub),
      "rss",
    );
    if (rss) return rss;
  } catch (err) {
    errors.push(`rss: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const pub = await collectForSource(
      (sub, q) => searchPublicInSubreddit(q, sub, perSub),
      "public",
    );
    if (pub) return pub;
  } catch (err) {
    errors.push(`public: ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(errors.join("; ") || "reddit_unreachable");
}

/** Hot posts for trending via RSS when OAuth/public JSON fail. */
export async function fetchSubredditHotLive(
  subreddit: string,
  limit = 25,
): Promise<LiveRedditSearchResult[]> {
  try {
    return await fetchSubredditHotRss(subreddit, limit);
  } catch {
    return [];
  }
}
