import type { OslawPost } from "@/lib/oslaw/types";
import { getRedditAccessToken, hasRedditOAuthCredentials } from "./oauth";
import { fetchRedditPublic, REDDIT_USER_AGENT } from "./public-fetch";
import { fetchSubredditHotRss } from "./rss";
import type { RedditListingChild, RedditSearchListing } from "./types";

function buildSnippet(selftext: string | undefined): string {
  const text = (selftext ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function mapChildToPost(
  child: RedditListingChild,
  subreddit: string,
  listingSource: string,
): OslawPost | null {
  const data = child.data;
  if (!data?.title?.trim()) return null;

  const permalink = data.permalink?.trim()
    ? data.permalink.startsWith("http")
      ? data.permalink
      : `https://www.reddit.com${data.permalink}`
    : "";

  const url = permalink || (data.url?.trim().startsWith("http") ? data.url.trim() : "");

  return {
    id: data.id?.trim() || permalink || data.title.trim(),
    title: data.title.trim(),
    url: url || `https://www.reddit.com/r/${subreddit}/`,
    permalink: permalink || `https://www.reddit.com/r/${subreddit}/`,
    subreddit: (data.subreddit ?? subreddit).trim(),
    score: typeof data.score === "number" ? data.score : 0,
    numComments: typeof data.num_comments === "number" ? data.num_comments : 0,
    createdUtc: typeof data.created_utc === "number" ? data.created_utc : 0,
    snippet: buildSnippet(data.selftext),
    listingSource,
  };
}

export type FetchListingOptions = {
  sort: "hot" | "new" | "top";
  time?: "hour" | "day" | "week";
  limit?: number;
};

function listingPath(subreddit: string, options: FetchListingOptions, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.sort === "top" && options.time) {
    params.set("t", options.time);
  }
  return `/r/${subreddit}/${options.sort}.json?${params}`;
}

/**
 * Fetch a subreddit listing via Reddit's public JSON endpoint (no OAuth required).
 */
export async function fetchSubredditListingPublic(
  subreddit: string,
  options: FetchListingOptions,
): Promise<OslawPost[]> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 25));
  const response = await fetchRedditPublic(listingPath(subreddit, options, limit));

  const listing = (await response.json()) as RedditSearchListing;
  const listingSource = options.time ? `${options.sort}:${options.time}` : options.sort;

  return (listing.data?.children ?? [])
    .map((child) => mapChildToPost(child, subreddit, listingSource))
    .filter((post): post is OslawPost => post !== null);
}

async function fetchSubredditListingOAuth(
  subreddit: string,
  options: FetchListingOptions,
): Promise<OslawPost[]> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 25));
  const token = await getRedditAccessToken();
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.sort === "top" && options.time) {
    params.set("t", options.time);
  }

  const response = await fetch(
    `https://oauth.reddit.com/r/${subreddit}/${options.sort}?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": REDDIT_USER_AGENT,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Reddit OAuth listing HTTP ${response.status} for r/${subreddit}/${options.sort}`);
  }

  const listing = (await response.json()) as RedditSearchListing;
  const listingSource = `oauth:${options.time ? `${options.sort}:${options.time}` : options.sort}`;

  return (listing.data?.children ?? [])
    .map((child) => mapChildToPost(child, subreddit, listingSource))
    .filter((post): post is OslawPost => post !== null);
}

/** Public JSON with OAuth → RSS fallback (RSS works from CI without Reddit API app). */
export async function fetchSubredditListing(
  subreddit: string,
  options: FetchListingOptions,
): Promise<{ posts: OslawPost[]; source: "public" | "oauth" | "rss" }> {
  const errors: string[] = [];

  if (hasRedditOAuthCredentials()) {
    try {
      const posts = await fetchSubredditListingOAuth(subreddit, options);
      return { posts, source: "oauth" };
    } catch (err) {
      errors.push(`oauth: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const posts = await fetchSubredditListingPublic(subreddit, options);
    return { posts, source: "public" };
  } catch (err) {
    errors.push(`public: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (options.sort === "hot") {
    try {
      const limit = Math.min(50, Math.max(1, options.limit ?? 25));
      const rssRows = await fetchSubredditHotRss(subreddit, limit);
      const posts: OslawPost[] = rssRows.map((row) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        permalink: row.url,
        subreddit: subreddit,
        score: row.score,
        numComments: row.comments,
        createdUtc: row.createdUtc,
        snippet: row.snippet ?? "",
        listingSource: "rss:hot",
      }));
      if (posts.length) return { posts, source: "rss" };
    } catch (err) {
      errors.push(`rss: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(errors.join("; ") || "reddit_unreachable");
}

export type SubredditAbout = {
  subscribers: number | null;
  publicDescription: string;
};

export async function fetchSubredditAboutPublic(subreddit: string): Promise<SubredditAbout> {
  try {
    const response = await fetchRedditPublic(`/r/${subreddit}/about.json`);
    const payload = (await response.json()) as {
      data?: { subscribers?: number; public_description?: string };
    };

    return {
      subscribers: typeof payload.data?.subscribers === "number" ? payload.data.subscribers : null,
      publicDescription: payload.data?.public_description?.trim() ?? "",
    };
  } catch {
    return { subscribers: null, publicDescription: "" };
  }
}

export function dedupeOslawPosts(posts: OslawPost[]): OslawPost[] {
  const byId = new Map<string, OslawPost>();
  for (const post of posts) {
    const key = post.id || post.permalink;
    const existing = byId.get(key);
    if (!existing || engagementScore(post) > engagementScore(existing)) {
      byId.set(key, post);
    }
  }
  return [...byId.values()];
}

export function engagementScore(post: OslawPost): number {
  return post.score + post.numComments * 2;
}
