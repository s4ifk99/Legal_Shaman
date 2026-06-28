import { buildTrendingTopics } from "@/lib/oslaw/build-trending";
import { OSLAW_SUBREDDITS } from "@/lib/oslaw/config";
import { getOslawTrendingData } from "@/lib/oslaw/data";
import type { OslawPost, OslawSubredditSnapshot, OslawTrendingData } from "@/lib/oslaw/types";
import {
  dedupeOslawPosts,
  engagementScore,
  fetchSubredditAboutPublic,
  fetchSubredditListing,
} from "@/lib/reddit-search/listing";
import { fetchSubredditHotLive } from "@/lib/reddit-search/live-search";
import { hasRedditOAuthCredentials } from "@/lib/reddit-search/oauth";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  data: OslawTrendingData;
  source: "live" | "rss" | "fallback";
};

let trendingCache: CacheEntry | null = null;

function rssRowToPost(row: Awaited<ReturnType<typeof fetchSubredditHotLive>>[number]): OslawPost {
  const sub = row.subreddit.replace(/^r\//, "");
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    permalink: row.url,
    subreddit: sub,
    score: row.score,
    numComments: row.comments,
    createdUtc: row.createdUtc || Math.floor(Date.now() / 1000),
    snippet: row.snippet,
    listingSource: "rss:hot",
  };
}

async function scrapeSubredditOAuth(
  name: string,
  displayName: string,
  description: string,
): Promise<{ snapshot: OslawSubredditSnapshot; ingestSource: "public" | "oauth" }> {
  const posts = [];
  let ingestSource: "public" | "oauth" = "public";

  for (const source of [{ sort: "hot" as const }, { sort: "top" as const, time: "day" as const }]) {
    const batch = await fetchSubredditListing(name, {
      sort: source.sort,
      time: "time" in source ? source.time : undefined,
      limit: 20,
    });
    if (batch.source === "oauth") ingestSource = "oauth";
    posts.push(...batch.posts);
  }

  const about = await fetchSubredditAboutPublic(name);
  const deduped = dedupeOslawPosts(posts).sort((a, b) => engagementScore(b) - engagementScore(a));

  return {
    snapshot: {
      name,
      displayName,
      description: about.publicDescription || description,
      subscribers: about.subscribers,
      posts: deduped.slice(0, 40),
    },
    ingestSource,
  };
}

async function scrapeSubredditRss(
  name: string,
  displayName: string,
  description: string,
): Promise<OslawSubredditSnapshot> {
  const rows = await fetchSubredditHotLive(name, 25);
  const about = await fetchSubredditAboutPublic(name);
  const posts = dedupeOslawPosts(rows.map(rssRowToPost)).sort(
    (a, b) => engagementScore(b) - engagementScore(a),
  );

  return {
    name,
    displayName,
    description: about.publicDescription || description,
    subscribers: about.subscribers,
    posts,
  };
}

/** Live OSLAW trending: OAuth → RSS → bundled JSON fallback. */
export async function fetchLiveOslawTrendingData(): Promise<{
  data: OslawTrendingData;
  source: "live" | "rss" | "fallback";
}> {
  if (trendingCache && Date.now() < trendingCache.expiresAt) {
    return { data: trendingCache.data, source: trendingCache.source };
  }

  const subreddits: OslawSubredditSnapshot[] = [];
  let source: "live" | "rss" = hasRedditOAuthCredentials() ? "live" : "rss";
  let ingestSource: "public" | "oauth" = "public";

  if (hasRedditOAuthCredentials()) {
    await Promise.all(
      OSLAW_SUBREDDITS.map(async (config) => {
        try {
          const result = await scrapeSubredditOAuth(
            config.name,
            config.displayName,
            config.description,
          );
          subreddits.push(result.snapshot);
          if (result.ingestSource === "oauth") ingestSource = "oauth";
        } catch {
          // fall through to RSS per sub below
        }
      }),
    );
  }

  if (subreddits.length < OSLAW_SUBREDDITS.length) {
    source = "rss";
    const existing = new Set(subreddits.map((s) => s.name));
    await Promise.all(
      OSLAW_SUBREDDITS.filter((c) => !existing.has(c.name)).map(async (config) => {
        try {
          subreddits.push(
            await scrapeSubredditRss(config.name, config.displayName, config.description),
          );
        } catch (err) {
          console.warn(`[oslaw/rss] hot scrape failed for r/${config.name}:`, err);
        }
      }),
    );
  }

  if (!subreddits.length) {
    const fallback = getOslawTrendingData();
    return { data: fallback, source: "fallback" };
  }

  const allPosts = dedupeOslawPosts(subreddits.flatMap((s) => s.posts));
  const data: OslawTrendingData = {
    meta: {
      scrapedAt: new Date().toISOString(),
      subredditCount: subreddits.length,
      postCount: allPosts.length,
      topicCount: 0,
      ingestSource: ingestSource === "oauth" ? "oauth" : "public",
    },
    subreddits: subreddits.sort((a, b) => a.name.localeCompare(b.name)),
    trendingTopics: buildTrendingTopics(allPosts),
  };
  data.meta.topicCount = data.trendingTopics.length;

  trendingCache = { expiresAt: Date.now() + CACHE_TTL_MS, data, source };
  return { data, source };
}
