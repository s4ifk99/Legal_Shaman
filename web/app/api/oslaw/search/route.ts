import { NextResponse } from "next/server";
import { listOslawSearchSubredditNames } from "@/lib/oslaw/config";
import { searchCachedOslawPosts } from "@/lib/oslaw/search-cached";
import { fetchLiveRedditSearch } from "@/lib/reddit-search/live-search";
import { requireSearchAuthResponse } from "@/lib/auth/require-search-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authBlock = await requireSearchAuthResponse();
  if (authBlock) return authBlock;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit") || 12) || 12));

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const { results, source } = await fetchLiveRedditSearch(q, limit);
    return NextResponse.json({
      results,
      source,
      subreddits: listOslawSearchSubredditNames(),
    });
  } catch (liveError) {
    console.warn("[/api/oslaw/search] live fetch failed:", liveError);

    const cached = searchCachedOslawPosts(q, limit);

    if (cached.length) {
      return NextResponse.json({
        results: cached,
        source: "cached" as const,
        degraded: true,
        message: `Live Reddit is unreachable. Showing matches from the last cached OSLAW scrape.`,
      });
    }

    return NextResponse.json(
      {
        results: [],
        error: "reddit_unreachable",
        message:
          "Reddit is not reachable from this server. Check REDDIT_* credentials in production or try again shortly.",
      },
      { status: 503 },
    );
  }
}
