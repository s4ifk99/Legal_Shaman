/** A normalized Reddit post from r/LegalAdviceUK search. */
export type RedditResult = {
  title: string;
  url: string;
  subreddit: string;
  score: number;
  createdUtc: number;
  snippet: string;
};

/** LLM-generated plan for Reddit search queries. */
export type SearchPlan = {
  legal_area: string;
  issue_summary: string;
  search_queries: string[];
};

/** Reddit result with LLM relevance scoring. */
export type RankedRedditResult = RedditResult & {
  relevanceScore: number;
  whyRelevant: string;
};

/** Output from the relevance scorer. */
export type RankResultsResponse = {
  enough_good_results: boolean;
  results: RankedRedditResult[];
};

/** Final output from the agentic Reddit search orchestrator. */
export type RedditAgentSearchResult = {
  legal_area: string;
  issue_summary: string;
  enough_good_results: boolean;
  rounds_used: number;
  results: RankedRedditResult[];
};

/** Raw OpenAI-compatible chat completion response (partial). */
export type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

/** Reddit OAuth token response. */
export type RedditTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
};

/** Reddit listing API child node (partial). */
export type RedditListingChild = {
  data?: {
    title?: string;
    url?: string;
    permalink?: string;
    subreddit?: string;
    score?: number;
    created_utc?: number;
    selftext?: string;
  };
};

export type RedditSearchListing = {
  data?: {
    children?: RedditListingChild[];
  };
};
