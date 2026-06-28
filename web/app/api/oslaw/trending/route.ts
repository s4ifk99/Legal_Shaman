import { NextResponse } from "next/server";
import { formatOslawScrapedAt, getOslawTrendingData } from "@/lib/oslaw/data";
import { fetchLiveOslawTrendingData } from "@/lib/oslaw/live-trending";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { data, source } = await fetchLiveOslawTrendingData();
    return NextResponse.json({
      ...data,
      source,
      live: source === "live",
    });
  } catch (error) {
    console.warn("[/api/oslaw/trending] live fetch failed:", error);
    const fallback = getOslawTrendingData();
    return NextResponse.json({
      ...fallback,
      source: "fallback" as const,
      live: false,
      message: `Showing cached OSLAW data (${formatOslawScrapedAt(fallback.meta.scrapedAt)}).`,
    });
  }
}
