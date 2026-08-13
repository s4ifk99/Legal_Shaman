import { NextResponse } from "next/server";
import { z } from "zod";

import { logLegalKnowledgeInteraction } from "@/lib/legal-knowledge/observability";
import { runLegalKnowledgeSearch } from "@/lib/legal-knowledge/search";
import { LEGAL_SEARCH_DISCLAIMER } from "@/lib/legal-knowledge/types";
import { requireSearchAuthResponse } from "@/lib/auth/require-search-auth";
import {
  MAX_SEARCH_QUERY_CHARS,
  processSearchQuery,
  searchQueryTooLongMessage,
} from "@/lib/legal-search/query-limits";

export const runtime = "nodejs";
/** Keep under Vercel Pro 60s hard kill so clients always get JSON, not a plain-text timeout page. */
export const maxDuration = 60;

/** Leave headroom before the platform kills the function (Hobby ~10s, Pro 60s). */
const SEARCH_DEADLINE_MS = Number(
  process.env.LEGAL_SEARCH_DEADLINE_MS ?? (process.env.VERCEL === "1" ? 25_000 : 50_000),
);

const LegalSearchInput = z.object({
  query: z.string().trim().min(2).max(MAX_SEARCH_QUERY_CHARS),
  location: z.string().trim().max(120).optional(),
  jurisdiction: z.string().trim().max(64).optional(),
  includeDirectory: z.boolean().optional(),
});

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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
    const queryIssue = parsed.error.flatten().fieldErrors.query?.[0];
    const tooLong = /at most|too (big|long)|maximum/i.test(queryIssue ?? "");
    return NextResponse.json(
      {
        error: tooLong ? searchQueryTooLongMessage() : "Invalid input",
        details: parsed.error.flatten(),
        disclaimer: LEGAL_SEARCH_DISCLAIMER,
      },
      { status: 400 },
    );
  }

  try {
    const t0 = Date.now();
    const result = await withDeadline(
      runLegalKnowledgeSearch({
        ...parsed.data,
        query: processSearchQuery(parsed.data.query),
      }),
      SEARCH_DEADLINE_MS,
      "legal-search",
    );
    void logLegalKnowledgeInteraction({
      query: parsed.data.query,
      issueClassification: result.issueClassification,
      taxonomySlug: result.issueClassification.subArea,
      specificIssue: result.issueClassification.specificIssue,
      intentSignals: result.debug?.intentSignals,
      intentConfidence: result.debug?.classificationFusion?.fusionSource,
      answerMode: result.answerMode,
      conceptCluster: result.debug?.conceptCluster,
      clarifyingAsked: Boolean(result.clarifyingQuestion),
      sourceUrls: result.sources.map((s) => s.url).filter(Boolean),
      directoryIds: result.directoryResults.map((d) => d.id),
      confidence: result.confidence,
      latencyMs: Date.now() - t0,
      degradedModes: result.debug?.mode ? [result.debug.mode] : undefined,
      fusion: result.debug?.classificationFusion
        ? {
            fusionSource: result.debug.classificationFusion.fusionSource as "rules" | "llm" | "agreed",
            ruleTaxonomySlug: result.debug.classificationFusion.ruleTaxonomySlug,
            llmTaxonomySlug: result.debug.classificationFusion.llmTaxonomySlug,
            ruleMatchStrength: result.debug.classificationFusion.ruleMatchStrength ?? 0,
            llmConfidence: result.debug.classificationFusion.llmConfidence,
            searchBoostTerms: [],
            confidence: "medium",
            phraseCandidates: result.debug.classificationFusion.phraseCandidates ?? [],
          }
        : undefined,
      satnav: result.debug?.searchRouteMode
        ? {
            routeDecision: result.debug.routeDecision,
            chosenRouteIds: result.debug.chosenRouteIds,
            llmRouteConfidence: result.debug.llmRouteAdvice?.confidence,
          }
        : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/legal-search]", err);
    const message = err instanceof Error ? err.message : "Legal search failed";
    const timedOut = /timed out/i.test(message);
    return NextResponse.json(
      {
        error: timedOut
          ? "Search timed out. Try a shorter query, or try again in a moment."
          : "Legal search failed",
        disclaimer: LEGAL_SEARCH_DISCLAIMER,
      },
      { status: timedOut ? 504 : 500 },
    );
  }
}
