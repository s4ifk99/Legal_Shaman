import { getOslawTrendingData } from "@/lib/oslaw/data";
import { rankAndFilterOslawResults, scoreOslawResultRelevance } from "@/lib/oslaw/search-queries";
import type { OslawPost } from "@/lib/oslaw/types";

export type OslawSearchResult = {
  id: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  comments: number;
  snippet?: string;
};

function toApiResult(post: OslawPost): OslawSearchResult {
  return {
    id: post.id,
    title: post.title,
    url: post.permalink || post.url,
    subreddit: `r/${post.subreddit}`,
    score: post.score,
    comments: post.numComments,
    snippet: post.snippet,
  };
}

/** Search locally cached OSLAW posts when live Reddit is unreachable. */
export function searchCachedOslawPosts(query: string, limit = 8): OslawSearchResult[] {
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

  const candidates = posts
    .map((post) => ({
      post,
      title: post.title,
      snippet: post.snippet,
      score: post.score,
      comments: post.numComments,
      relevance: scoreOslawResultRelevance(query, post.title, post.snippet),
    }))
    .filter((row) => row.relevance >= 4);

  const ranked = rankAndFilterOslawResults(
    query,
    candidates.map(({ title, snippet, score, comments }) => ({
      title,
      snippet,
      score,
      comments,
    })),
    limit,
  );

  const byTitle = new Map(candidates.map((c) => [c.title, c.post]));
  return ranked
    .map((row) => byTitle.get(row.title))
    .filter((post): post is OslawPost => Boolean(post))
    .map(toApiResult);
}
