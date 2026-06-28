/**
 * Scrape legal subreddits for OSLAW trending topics (2× daily via GitHub Actions).
 *
 * Usage: npm run reddit:trending:ingest
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import "./load-dotenv";

import { buildTrendingTopics } from "../lib/oslaw/build-trending";
import { OSLAW_LISTING_LIMIT, OSLAW_LISTING_SOURCES, OSLAW_SUBREDDITS } from "../lib/oslaw/config";
import type { OslawSubredditSnapshot, OslawTrendingData } from "../lib/oslaw/types";
import {
  dedupeOslawPosts,
  engagementScore,
  fetchSubredditAboutPublic,
  fetchSubredditListing,
} from "../lib/reddit-search/listing";

const OUTPUT = resolve(process.cwd(), "data/reddit-trending.json");

async function scrapeSubreddit(name: string, displayName: string, description: string) {
  const posts = [];
  let ingestSource: "public" | "oauth" | "rss" = "public";

  for (const source of OSLAW_LISTING_SOURCES) {
    try {
      const batch = await fetchSubredditListing(name, {
        sort: source.sort,
        time: source.time,
        limit: OSLAW_LISTING_LIMIT,
      });
      if (batch.source === "oauth") ingestSource = "oauth";
      else if (batch.source === "rss") ingestSource = "rss";
      posts.push(...batch.posts);
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "oslaw_listing_source_error",
          subreddit: name,
          sort: source.sort,
          time: source.time ?? null,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    await sleep(1500);
  }

  if (!posts.length) {
    throw new Error("no posts from any listing source");
  }

  const about = await fetchSubredditAboutPublic(name);
  await sleep(1100);

  const deduped = dedupeOslawPosts(posts).sort((a, b) => engagementScore(b) - engagementScore(a));

  const snapshot: OslawSubredditSnapshot = {
    name,
    displayName,
    description: about.publicDescription || description,
    subscribers: about.subscribers,
    posts: deduped.slice(0, OSLAW_LISTING_LIMIT * 2),
  };

  console.info(
    JSON.stringify({
      event: "oslaw_subreddit_scraped",
      subreddit: name,
      posts: snapshot.posts.length,
      subscribers: snapshot.subscribers,
      ingestSource,
    }),
  );

  return { snapshot, ingestSource };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const subreddits: OslawSubredditSnapshot[] = [];
  let ingestSource: "public" | "oauth" | "rss" = "public";

  for (const config of OSLAW_SUBREDDITS) {
    try {
      const result = await scrapeSubreddit(config.name, config.displayName, config.description);
      subreddits.push(result.snapshot);
      if (result.ingestSource === "oauth") ingestSource = "oauth";
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "oslaw_subreddit_error",
          subreddit: config.name,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  if (!subreddits.length) {
    console.error("No subreddits scraped — aborting without writing output.");
    process.exit(1);
  }

  const allPosts = dedupeOslawPosts(subreddits.flatMap((s) => s.posts));
  const trendingTopics = buildTrendingTopics(allPosts);

  const payload: OslawTrendingData = {
    meta: {
      scrapedAt: new Date().toISOString(),
      subredditCount: subreddits.length,
      postCount: allPosts.length,
      topicCount: trendingTopics.length,
      ingestSource,
    },
    subreddits,
    trendingTopics,
  };

  writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.info(
    JSON.stringify({
      event: "oslaw_trending_ingest_done",
      output: OUTPUT,
      ...payload.meta,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
