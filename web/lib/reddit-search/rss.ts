import { REDDIT_USER_AGENT } from "./public-fetch";
import type { LiveRedditSearchResult } from "./types";

const RSS_TIMEOUT_MS = 15_000;

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#32;/g, " ");
}

function stripHtml(html: string): string {
  return decodeXml(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePublishedIso(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export function parseRedditAtomFeed(xml: string, subreddit: string): LiveRedditSearchResult[] {
  const chunks = xml.split("<entry>");
  const results: LiveRedditSearchResult[] = [];

  for (const chunk of chunks.slice(1)) {
    const entry = chunk.split("</entry>")[0] ?? "";
    const title = decodeXml(entry.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? "");
    if (!title) continue;

    const url =
      entry.match(/<link href="([^"]+)"/)?.[1]?.trim() ||
      `https://www.reddit.com/r/${subreddit}/`;
    const rawId = entry.match(/<id>([^<]*)<\/id>/)?.[1]?.trim() ?? "";
    const id = rawId.replace(/^t3_/, "") || url;
    const published = entry.match(/<published>([^<]*)<\/published>/)?.[1];
    const content = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "";
    const snippet = stripHtml(content).slice(0, 280);

    results.push({
      id,
      title,
      url,
      subreddit: `r/${subreddit}`,
      score: 0,
      comments: 0,
      snippet,
      createdUtc: parsePublishedIso(published),
    });
  }

  return results;
}

async function fetchRssText(path: string): Promise<string> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);
  try {
    const response = await fetch(`https://www.reddit.com${normalized}`, {
      headers: { "User-Agent": REDDIT_USER_AGENT, Accept: "application/atom+xml" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`RSS HTTP ${response.status} for ${normalized}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Subreddit search via public Atom RSS — no Reddit API app required. */
export async function searchSubredditRss(
  subreddit: string,
  query: string,
  limit = 15,
): Promise<LiveRedditSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    sort: "relevance",
  });
  const xml = await fetchRssText(`/r/${subreddit}/search.rss?${params}`);
  return parseRedditAtomFeed(xml, subreddit).slice(0, limit);
}

/** Hot listing via public Atom RSS — no Reddit API app required. */
export async function fetchSubredditHotRss(
  subreddit: string,
  limit = 25,
): Promise<LiveRedditSearchResult[]> {
  const xml = await fetchRssText(`/r/${subreddit}/hot.rss`);
  return parseRedditAtomFeed(xml, subreddit).slice(0, limit);
}
