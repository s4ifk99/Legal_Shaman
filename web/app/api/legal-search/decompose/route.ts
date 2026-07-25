import { NextResponse } from "next/server";
import { z } from "zod";

import { decomposeLegalSearchQuery } from "@/lib/legal-knowledge/decompose-query";
import { LEGAL_SEARCH_DISCLAIMER } from "@/lib/legal-knowledge/types";
import {
  MAX_SEARCH_QUERY_CHARS,
  processSearchQuery,
  searchQueryTooLongMessage,
} from "@/lib/legal-search/query-limits";

export const runtime = "nodejs";

const DecomposeInput = z.object({
  query: z.string().trim().min(2).max(MAX_SEARCH_QUERY_CHARS),
  location: z.string().trim().max(120).optional(),
  jurisdiction: z.string().trim().max(64).optional(),
  includeDirectory: z.boolean().optional(),
});

/** POST /api/legal-search/decompose — instant Exa-style criteria breakdown (no retrieval). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = DecomposeInput.safeParse(body);
  if (!parsed.success) {
    const queryIssue = parsed.error.flatten().fieldErrors.query?.[0];
    const tooLong = /at most|too (big|long)|maximum/i.test(queryIssue ?? "");
    return NextResponse.json(
      {
        error: tooLong ? searchQueryTooLongMessage() : "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const query = processSearchQuery(parsed.data.query);
  const searchCriteria = decomposeLegalSearchQuery({ ...parsed.data, query });
  return NextResponse.json({
    query,
    searchCriteria,
    disclaimer: LEGAL_SEARCH_DISCLAIMER,
  });
}
