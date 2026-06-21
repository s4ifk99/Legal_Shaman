/**
 * Write sample OSLAW trending data for local UI development when Reddit is unreachable.
 * Usage: npm run reddit:trending:seed
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildTrendingTopics } from "../lib/oslaw/build-trending";
import { OSLAW_SUBREDDITS } from "../lib/oslaw/config";
import type { OslawPost, OslawSubredditSnapshot, OslawTrendingData } from "../lib/oslaw/types";

const OUTPUT = resolve(process.cwd(), "data/reddit-trending.json");
const now = Math.floor(Date.now() / 1000);

function samplePost(
  subreddit: string,
  id: string,
  title: string,
  score: number,
  comments: number,
): OslawPost {
  return {
    id,
    title,
    url: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
    permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
    subreddit,
    score,
    numComments: comments,
    createdUtc: now - 3600 * 6,
    snippet: "Sample discussion post for local OSLAW development.",
    listingSource: "hot",
  };
}

const samples: Record<string, OslawPost[]> = {
  LegalAdviceUK: [
    samplePost("LegalAdviceUK", "seed1", "Landlord withholding deposit after tenancy ended", 142, 58),
    samplePost("LegalAdviceUK", "seed2", "Unfair dismissal — probation period and notice", 89, 34),
    samplePost("LegalAdviceUK", "seed3", "Section 21 notice received — is it valid?", 201, 91),
  ],
  uklaw: [
    samplePost("uklaw", "seed4", "Recent employment tribunal trends on remote work", 67, 22),
    samplePost("uklaw", "seed5", "Interpretation of Consumer Rights Act refunds", 45, 18),
  ],
  HousingUK: [
    samplePost("HousingUK", "seed6", "Council tax liability when moving between properties", 112, 44),
    samplePost("HousingUK", "seed7", "Damp and mould — landlord repair obligations", 178, 73),
  ],
  UKPersonalFinance: [
    samplePost("UKPersonalFinance", "seed8", "County Court Judgment and credit file impact", 95, 41),
  ],
};

const subreddits: OslawSubredditSnapshot[] = OSLAW_SUBREDDITS.map((config) => ({
  name: config.name,
  displayName: config.displayName,
  description: config.description,
  subscribers: 50_000,
  posts: samples[config.name] ?? [],
}));

const allPosts = subreddits.flatMap((s) => s.posts);
const payload: OslawTrendingData = {
  meta: {
    scrapedAt: new Date().toISOString(),
    subredditCount: subreddits.length,
    postCount: allPosts.length,
    topicCount: 0,
    ingestSource: "public",
  },
  subreddits,
  trendingTopics: buildTrendingTopics(allPosts),
};

payload.meta.topicCount = payload.trendingTopics.length;

writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.info(`Wrote sample OSLAW data to ${OUTPUT}`);
