import type {
  RedditListingChild,
  RedditResult,
  RedditSearchListing,
  RedditTokenResponse,
} from "./types";

const SUBREDDIT = "LegalAdviceUK";
const SEARCH_LIMIT = 10;
const USER_AGENT =
  process.env.REDDIT_USER_AGENT?.trim() ||
  "LegalShaman/1.0 (reddit-search; early-stage legal information retrieval)";

export class RedditSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedditSearchError";
  }
}

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new RedditSearchError(
      `Missing required environment variable: ${name} (set in web/.env.local)`,
    );
  }
  return value;
}

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

function buildPostUrl(child: RedditListingChild): string {
  const permalink = child.data?.permalink?.trim();
  if (permalink) {
    return permalink.startsWith("http")
      ? permalink
      : `https://www.reddit.com${permalink}`;
  }

  const rawUrl = child.data?.url?.trim();
  if (rawUrl?.startsWith("http")) return rawUrl;

  return `https://www.reddit.com/r/${SUBREDDIT}/`;
}

function buildSnippet(selftext: string | undefined): string {
  const text = (selftext ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function mapListingChild(child: RedditListingChild): RedditResult | null {
  const data = child.data;
  if (!data?.title?.trim()) return null;

  return {
    title: data.title.trim(),
    url: buildPostUrl(child),
    subreddit: (data.subreddit ?? SUBREDDIT).trim(),
    score: typeof data.score === "number" ? data.score : 0,
    createdUtc: typeof data.created_utc === "number" ? data.created_utc : 0,
    snippet: buildSnippet(data.selftext),
  };
}

/**
 * Obtain a Reddit OAuth access token (password grant), with in-memory caching.
 */
async function getRedditAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = requireEnv("REDDIT_CLIENT_ID");
  const clientSecret = requireEnv("REDDIT_CLIENT_SECRET");
  const username = requireEnv("REDDIT_USERNAME");
  const password = requireEnv("REDDIT_PASSWORD");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: "password",
        username,
        password,
      }),
    });
  } catch (err) {
    throw new RedditSearchError(
      `Reddit OAuth request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = (await response.json()) as RedditTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new RedditSearchError(
      data.error ?? `Reddit OAuth failed with HTTP ${response.status}`,
    );
  }

  const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 3600;
  cachedToken = {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };

  return data.access_token;
}

/**
 * Execute a single subreddit search query against r/LegalAdviceUK.
 */
async function searchSingleQuery(
  accessToken: string,
  query: string,
): Promise<RedditResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = new URL(`https://oauth.reddit.com/r/${SUBREDDIT}/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("limit", String(SEARCH_LIMIT));

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
    cachedToken = null;
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
    .map(mapListingChild)
    .filter((item): item is RedditResult => item !== null);
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
      results = await searchSingleQuery(accessToken, query);
    } catch (err) {
      if (err instanceof RedditSearchError && err.message.includes("expired")) {
        const refreshed = await getRedditAccessToken();
        results = await searchSingleQuery(refreshed, query);
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
