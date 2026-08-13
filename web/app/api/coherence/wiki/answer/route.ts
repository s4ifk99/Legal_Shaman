import { NextResponse } from "next/server";

import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import {
  MAX_SEARCH_QUERY_CHARS,
  searchQueryTooLongMessage,
} from "@/lib/legal-search/query-limits";
import { generateWikiAnswer } from "@/lib/wiki/generate-answer";
import { getWikiIndex } from "@/lib/wiki/load-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  query?: string;
};

/**
 * Legal Shaman vault answer for Coherence Overview.
 * Uses the same generateWikiAnswer path as classic Ask-the-Shaman.
 */
export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (query.length < 2) {
    return NextResponse.json({ error: "query_too_short" }, { status: 400 });
  }
  if (query.length > MAX_SEARCH_QUERY_CHARS) {
    return NextResponse.json(
      { error: "query_too_long", message: searchQueryTooLongMessage() },
      { status: 400 },
    );
  }

  const payload = await generateWikiAnswer(query);
  const index = getWikiIndex();

  return NextResponse.json({
    ...payload,
    meta: {
      pageCount: index.meta.pageCount,
      indexedAt: index.meta.indexedAt,
      wikiRoot: index.meta.wikiRoot,
    },
  });
}
