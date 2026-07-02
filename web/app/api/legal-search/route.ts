import { NextResponse } from "next/server";
import { z } from "zod";

import { runLegalKnowledgeSearch } from "@/lib/legal-knowledge/search";
import { LEGAL_SEARCH_DISCLAIMER } from "@/lib/legal-knowledge/types";
import { requireSearchAuthResponse } from "@/lib/auth/require-search-auth";

export const runtime = "nodejs";

const LegalSearchInput = z.object({
  query: z.string().trim().min(2).max(800),
  location: z.string().trim().max(120).optional(),
  jurisdiction: z.string().trim().max(64).optional(),
  includeDirectory: z.boolean().optional(),
});

/**
 * POST /api/legal-search
 * Exa-style semantic legal search over curated UK legal knowledge + directory fallback.
 */
export async function POST(req: Request) {
  const authBlock = await requireSearchAuthResponse();
  if (authBlock) return authBlock;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = LegalSearchInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten(), disclaimer: LEGAL_SEARCH_DISCLAIMER },
      { status: 400 },
    );
  }

  try {
    const result = await runLegalKnowledgeSearch(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/legal-search]", err);
    return NextResponse.json(
      {
        error: "Legal search failed",
        disclaimer: LEGAL_SEARCH_DISCLAIMER,
      },
      { status: 500 },
    );
  }
}
