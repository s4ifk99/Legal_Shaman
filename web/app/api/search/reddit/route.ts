import { NextResponse } from "next/server";
import { formatOslawScrapedAt, getOslawTrendingData } from "@/lib/oslaw/data";
import { searchCachedOslawPosts } from "@/lib/oslaw/search-cached";
import { fetchLiveRedditSearch } from "@/lib/reddit-search/live-search";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit") || 8) || 8));

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await fetchLiveRedditSearch(q, limit);
    return NextResponse.json({ results, source: "live" as const });
  } catch (liveError) {
    console.warn("[/api/search/reddit] live fetch failed:", liveError);

    const cached = searchCachedOslawPosts(q, limit);
    const meta = getOslawTrendingData().meta;

    if (cached.length) {
      return NextResponse.json({
        results: cached,
        source: "cached" as const,
        degraded: true,
        message: `Live Reddit is unreachable. Showing matches from the last OSLAW scrape (${formatOslawScrapedAt(meta.scrapedAt)}).`,
      });
    }

    return NextResponse.json(
      {
        results: [],
        error: "reddit_unreachable",
        message:
          "Reddit is not reachable from this server and no cached OSLAW posts matched your query. Try /oslaw for trending discussions or run npm run reddit:trending:ingest.",
      },
      { status: 503 },
    );
  }
}
