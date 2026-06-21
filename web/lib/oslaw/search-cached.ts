import { getOslawTrendingData } from "@/lib/oslaw/data";
import type { OslawPost } from "@/lib/oslaw/types";
import { engagementScore } from "@/lib/reddit-search/listing";

export type OslawSearchResult = {
  id: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  comments: number;
};

function toApiResult(post: OslawPost): OslawSearchResult {
  return {
    id: post.id,
    title: post.title,
    url: post.permalink || post.url,
    subreddit: `r/${post.subreddit}`,
    score: post.score,
    comments: post.numComments,
  };
}

function relevanceScore(post: OslawPost, terms: string[]): number {
  const haystack = `${post.title} ${post.snippet}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length >= 4 ? 3 : 1;
  }
  return score + engagementScore(post) * 0.01;
}

/** Search locally cached OSLAW posts when live Reddit is unreachable. */
export function searchCachedOslawPosts(query: string, limit = 8): OslawSearchResult[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (!terms.length) return [];

  const data = getOslawTrendingData();
  const posts: OslawPost[] = [];
  const seen = new Set<string>();

  for (const sub of data.subreddits) {
    for (const post of sub.posts) {
      const key = post.id || post.permalink;
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push(post);
    }
  }

  return posts
    .map((post) => ({ post, score: relevanceScore(post, terms) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => toApiResult(row.post));
}
