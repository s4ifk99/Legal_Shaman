import trendingRaw from "@/data/reddit-trending.json";
import type { OslawPost, OslawTrendingData } from "@/lib/oslaw/types";
import { engagementScore } from "@/lib/reddit-search/listing";

const EMPTY: OslawTrendingData = {
  meta: {
    scrapedAt: "",
    subredditCount: 0,
    postCount: 0,
    topicCount: 0,
    ingestSource: "public",
  },
  subreddits: [],
  trendingTopics: [],
};

export function getOslawTrendingData(): OslawTrendingData {
  const data = trendingRaw as OslawTrendingData;
  if (!data?.subreddits?.length) return EMPTY;
  return data;
}

export function formatOslawScrapedAt(iso: string): string {
  if (!iso) return "Not yet updated";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/London",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatRelativeTime(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(unixSeconds * 1000));
}

/** Top posts for the OSLAW news-style marquee (deduped, by engagement). */
export function getOslawMarqueePosts(limit = 16): OslawPost[] {
  const data = getOslawTrendingData();
  const seen = new Set<string>();
  const posts: OslawPost[] = [];

  for (const sub of data.subreddits) {
    for (const post of sub.posts) {
      const key = post.id || post.permalink;
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push(post);
    }
  }

  return posts.sort((a, b) => engagementScore(b) - engagementScore(a)).slice(0, limit);
}
