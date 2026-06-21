/** Normalized Reddit post for OSLAW trending browse. */
export type OslawPost = {
  id: string;
  title: string;
  url: string;
  permalink: string;
  subreddit: string;
  score: number;
  numComments: number;
  createdUtc: number;
  snippet: string;
  /** hot | new | top */
  listingSource: string;
};

export type OslawSubredditSnapshot = {
  name: string;
  displayName: string;
  description: string;
  subscribers: number | null;
  posts: OslawPost[];
};

export type OslawTrendingTopic = {
  slug: string;
  label: string;
  legalAreaSlug: string | null;
  postCount: number;
  engagementScore: number;
  subreddits: string[];
  posts: OslawPost[];
};

export type OslawTrendingMeta = {
  scrapedAt: string;
  subredditCount: number;
  postCount: number;
  topicCount: number;
  ingestSource: "oauth" | "public";
};

export type OslawTrendingData = {
  meta: OslawTrendingMeta;
  subreddits: OslawSubredditSnapshot[];
  trendingTopics: OslawTrendingTopic[];
};
