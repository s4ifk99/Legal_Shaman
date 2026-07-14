import { NextResponse } from "next/server";
import { z } from "zod";

import { logLegalKnowledgeInteraction } from "@/lib/legal-knowledge/observability";
import { runLegalKnowledgeSearch } from "@/lib/legal-knowledge/search";
import { LEGAL_SEARCH_DISCLAIMER } from "@/lib/legal-knowledge/types";
import { requireSearchAuthResponse } from "@/lib/auth/require-search-auth";

export const runtime = "nodejs";
/** Ollama via home tunnel can take 30–60s; raise limit on Pro (Hobby still caps ~10s). */
export const maxDuration = 60;

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
    const t0 = Date.now();
    const result = await runLegalKnowledgeSearch(parsed.data);
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
    });
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
