import { NextResponse } from "next/server";

import { requireSearchAuthResponse } from "@/lib/auth/require-search-auth";
import { getWikiIndex } from "@/lib/wiki/load-index";
import { getWikiPageById, searchWikiPages } from "@/lib/wiki/search";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get("id") || "").trim();
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit") || 12) || 12));

  if (id) {
    const page = getWikiPageById(id);
    if (!page) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ page });
  }

  if (q.length < 2) {
    const index = getWikiIndex();
    return NextResponse.json({
      results: [],
      meta: {
        pageCount: index.meta.pageCount,
        indexedAt: index.meta.indexedAt,
      },
    });
  }

  const authBlock = await requireSearchAuthResponse();
  if (authBlock) return authBlock;

  const results = searchWikiPages(q, limit);
  return NextResponse.json({
    query: q,
    results,
    meta: {
      pageCount: getWikiIndex().meta.pageCount,
      indexedAt: getWikiIndex().meta.indexedAt,
    },
  });
}
