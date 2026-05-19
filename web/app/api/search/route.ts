import { NextResponse } from "next/server";
import type { SearchFacets } from "@/lib/search/rerank";
import {
  typesenseListingsConfigured,
  typesenseListingsReachable,
} from "@/lib/search/typesense-listings";
import { runMatcherUnified } from "@/lib/legal-search/run-matcher-unified";
import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import { enableSearchDebug } from "@/lib/legal-search/config";
import { stripSearchDebug } from "@/lib/legal-search/search-diagnostics";
import { logSearchInteraction } from "@/lib/legal-search/observability";
import { ensureSearchStartupLogged } from "@/lib/legal-search/search-startup";
import { AgentInputSchema, DISCLAIMER } from "@/lib/agent/types";

export const runtime = "nodejs";

/**
 * POST: agentic lawyer matcher (+ unified parsedQuery).
 * GET: directory search (unified engine with legacy JSON mapping).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = AgentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid input",
        details: parsed.error.flatten(),
        disclaimer: DISCLAIMER,
      },
      { status: 400 },
    );
  }

  try {
    await ensureSearchStartupLogged();
    const result = await runMatcherUnified(parsed.data);
    const payload = enableSearchDebug()
      ? result
      : stripSearchDebug(result as unknown as Record<string, unknown>);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[/api/search POST] agent failure:", err);
    return NextResponse.json(
      {
        kind: "matches",
        results: [],
        disclaimer: DISCLAIMER,
        error: "search_failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const semantic = searchParams.get("semantic") === "1";
  const limit = Math.min(80, Math.max(1, Number(searchParams.get("limit") || 40) || 40));
  const freeOnly = searchParams.get("free") === "1";
  const legalAidOnly = searchParams.get("legalAid") === "1";
  const city = (searchParams.get("city") || "").trim();
  const sessionId = (searchParams.get("sessionId") || "").trim() || undefined;
  const source = (searchParams.get("source") || "").trim() || undefined;
  const practiceArea = (searchParams.get("practiceArea") || "").trim() || undefined;
  const location = (searchParams.get("location") || "").trim() || undefined;
  const radius = Number(searchParams.get("radius") || "");
  const language = (searchParams.get("language") || "").trim() || undefined;
  const verifiedOnly = searchParams.get("verifiedOnly") === "1";
  const offset = Math.max(0, Number(searchParams.get("offset") || 0) || 0);

  const facets: SearchFacets | undefined =
    freeOnly || legalAidOnly || city
      ? {
          freeOnly: freeOnly || undefined,
          legalAidOnly: legalAidOnly || undefined,
          city: city || undefined,
        }
      : undefined;

  const stack = await ensureSearchStartupLogged();
  const tsConfigured = typesenseListingsConfigured();
  const tsOk = stack.typesenseReachable;

  if (!q) {
    return NextResponse.json({
      results: [],
      semanticUsed: false,
      typesenseListingsConfigured: tsConfigured,
      typesenseListingsReachable: tsOk,
      searchStack: stack,
    });
  }

  console.info(
    JSON.stringify({
      event: "search_api",
      qLen: q.length,
      qPrefix: q.slice(0, 120),
      semantic,
      limit,
      facets: { freeOnly, legalAidOnly, city: city || null },
    }),
  );

  const dir = await runDirectorySearch({
    query: q,
    limit,
    semantic,
    freeOnly,
    legalAidOnly,
    city,
    source,
    practiceArea,
    location,
    radius: Number.isFinite(radius) && radius > 0 ? radius : undefined,
    language,
    verifiedOnly,
    offset,
  });

  const semanticUsed =
    semantic &&
    dir.results.some((r) => {
      const raw = r.raw as { sources?: string[] } | null;
      return raw?.sources?.includes("semantic");
    });

  if (sessionId) {
    void logSearchInteraction({
      sessionId,
      channel: "directory",
      query: q,
      parsedQuery: dir.parsedQuery,
      clarifyingAsked: false,
      resultIds: dir.results.map((r) => r.id),
      latencyMs: dir.latencyMs,
      degradedModes: dir.degradedModes,
    });
  }

  const base = {
    semanticUsed,
    typesenseListingsConfigured: tsConfigured,
    typesenseListingsReachable: tsOk,
    results: dir.legacyRows,
  };

  if (enableSearchDebug() && dir.searchDebug) {
    return NextResponse.json({
      ...base,
      disclaimer:
        "This is not legal advice. Results are based on directory information and your search criteria.",
      searchDebug: dir.searchDebug,
      unifiedResults: dir.results,
    });
  }

  return NextResponse.json(base);
}
