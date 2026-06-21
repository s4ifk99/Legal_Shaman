import { fetchRedditPublic } from "./public-fetch";
import { hasRedditOAuthCredentials, searchReddit } from "./search";

const FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_SUBREDDIT = "LegalAdviceUK";

export type LiveRedditSearchResult = {
  id: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  comments: number;
};

type RedditApiListing = {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        title?: string;
        permalink?: string;
        subreddit_name_prefixed?: string;
        score?: number;
        num_comments?: number;
      };
    }>;
  };
};

function mapListing(payload: RedditApiListing, subreddit: string): LiveRedditSearchResult[] {
  return (payload.data?.children ?? [])
    .map((child) => child.data)
    .filter(Boolean)
    .map((post) => ({
      id: post!.id ?? "",
      title: post!.title ?? "Untitled post",
      url: post!.permalink
        ? `https://www.reddit.com${post!.permalink}`
        : `https://www.reddit.com/r/${subreddit}/`,
      subreddit: post!.subreddit_name_prefixed ?? `r/${subreddit}`,
      score: post!.score ?? 0,
      comments: post!.num_comments ?? 0,
    }));
}

async function searchPublic(query: string, limit: number): Promise<LiveRedditSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    sort: "relevance",
    t: "all",
    limit: String(limit),
  });
  const response = await fetchRedditPublic(
    `/r/${DEFAULT_SUBREDDIT}/search.json?${params}`,
    FETCH_TIMEOUT_MS,
  );
  const payload = (await response.json()) as RedditApiListing;
  return mapListing(payload, DEFAULT_SUBREDDIT);
}

async function searchOAuth(query: string, limit: number): Promise<LiveRedditSearchResult[]> {
  const results = await searchReddit([query]);
  return results.slice(0, limit).map((post) => ({
    id: post.url,
    title: post.title,
    url: post.url,
    subreddit: `r/${post.subreddit}`,
    score: post.score,
    comments: 0,
  }));
}

/** Try live Reddit search (OAuth when configured, then public JSON). */
export async function fetchLiveRedditSearch(
  query: string,
  limit = 8,
): Promise<LiveRedditSearchResult[]> {
  const errors: string[] = [];

  if (hasRedditOAuthCredentials()) {
    try {
      const results = await searchOAuth(query, limit);
      if (results.length) return results;
    } catch (err) {
      errors.push(`oauth: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const results = await searchPublic(query, limit);
    if (results.length) return results;
  } catch (err) {
    errors.push(`public: ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(errors.join("; ") || "reddit_unreachable");
}
