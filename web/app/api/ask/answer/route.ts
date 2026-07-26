import { NextResponse } from "next/server";

import { requireSearchAuthResponse } from "@/lib/auth/require-search-auth";
import {
  MAX_SEARCH_QUERY_CHARS,
  searchQueryTooLongMessage,
} from "@/lib/legal-search/query-limits";
import { generateWikiAnswer } from "@/lib/wiki/generate-answer";
import { getWikiIndex } from "@/lib/wiki/load-index";

export const runtime = "nodejs";

type AnswerRequestBody = {
  query?: string;
};

export async function POST(req: Request) {
  const authBlock = await requireSearchAuthResponse();
  if (authBlock) return authBlock;

  let body: AnswerRequestBody;
  try {
    body = (await req.json()) as AnswerRequestBody;
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

  console.info(
    JSON.stringify({
      event: "wiki_answer",
      query: query.slice(0, 200),
      mode: payload.mode,
      retrievalScore: payload.retrievalScore,
      wikiPageIds: payload.wikiPages.map((p) => p.id).slice(0, 8),
      firmCount: payload.recommendedFirms.length,
      latencyMs: payload.latencyMs,
      pageCount: index.meta.pageCount,
    }),
  );

  return NextResponse.json({
    ...payload,
    meta: {
      pageCount: index.meta.pageCount,
      indexedAt: index.meta.indexedAt,
    },
  });
}
