import { NextResponse } from "next/server";
import { z } from "zod";

import { runMatcherUnified } from "@/lib/legal-search/run-matcher-unified";
import { AppliedFiltersSchema, DISCLAIMER } from "@/lib/agent/types";
import { enableSearchDebug } from "@/lib/legal-search/config";
import { stripSearchDebug } from "@/lib/legal-search/search-diagnostics";
import {
  MAX_SEARCH_QUERY_CHARS,
  processSearchQuery,
  searchQueryTooLongMessage,
} from "@/lib/legal-search/query-limits";

export const runtime = "nodejs";

const ClarifyInput = z.object({
  originalQuery: z.string().trim().min(2).max(MAX_SEARCH_QUERY_CHARS),
  clarification: z.string().trim().min(1).max(400),
  sessionId: z.string().trim().min(1).max(128).optional(),
  appliedFilters: AppliedFiltersSchema.optional(),
});

/**
 * POST /api/search/clarify
 * Merges the user's clarifying answer back into the original query and re-runs
 * the agent. We force the agent to skip clarifying this time by enriching the
 * combined query — if it still fails, it returns the deterministic template.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ClarifyInput.safeParse(body);
  if (!parsed.success) {
    const queryIssue = parsed.error.flatten().fieldErrors.originalQuery?.[0];
    const tooLong = /at most|too (big|long)|maximum/i.test(queryIssue ?? "");
    return NextResponse.json(
      {
        error: tooLong ? searchQueryTooLongMessage() : "Invalid input",
        details: parsed.error.flatten(),
        disclaimer: DISCLAIMER,
      },
      { status: 400 },
    );
  }

  const mergedQuery = processSearchQuery(
    `${parsed.data.originalQuery.trim()}. Additional context: ${parsed.data.clarification.trim()}`,
  );

  try {
    const result = await runMatcherUnified({
      query: mergedQuery,
      sessionId: parsed.data.sessionId,
      appliedFilters: parsed.data.appliedFilters,
    });
    const payload = enableSearchDebug()
      ? result
      : stripSearchDebug(result as unknown as Record<string, unknown>);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[/api/search/clarify POST] agent failure:", err);
    return NextResponse.json(
      { kind: "matches", results: [], disclaimer: DISCLAIMER, error: "search_failed" },
      { status: 500 },
    );
  }
}
