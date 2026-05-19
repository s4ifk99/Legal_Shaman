import { NextResponse } from "next/server";
import { requireAdminApiRequest } from "@/lib/admin/auth";
import { loadFailedSearchReview, groupFailedSearchesByCluster } from "@/lib/search-quality/failed-search-review";
import { loadSearchQualityMetrics } from "@/lib/search-quality/metrics-dashboard";
import { analyzeTaxonomyGaps } from "@/lib/search-quality/taxonomy-gap-analysis";
import { analyzeSourceBalance } from "@/lib/search-quality/source-balance-analysis";
import { analyzeProviderCoverage } from "@/lib/search-quality/provider-coverage-analysis";
import { replaySearchInteraction } from "@/lib/search-quality/search-replay";
import { runRankingProbe } from "@/lib/search-quality/ranking-probe";
import { buildManualCurationSuggestions } from "@/lib/search-quality/manual-curation";
import { formatDirectoryEvalCaseSnippet } from "@/lib/search-quality/eval-integration";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") ?? "summary";

  try {
    if (action === "summary") {
      const [metrics, failedSample] = await Promise.all([
        loadSearchQualityMetrics(),
        loadFailedSearchReview({ limit: 15 }),
      ]);
      return NextResponse.json({
        metrics,
        failedPreview: failedSample.slice(0, 8),
        suggestions: buildManualCurationSuggestions(failedSample),
      });
    }

    if (action === "failed") {
      const rows = await loadFailedSearchReview({ limit: 120 });
      return NextResponse.json({ rows, clusters: groupFailedSearchesByCluster(rows) });
    }

    if (action === "taxonomy-gaps") {
      const report = await analyzeTaxonomyGaps();
      return NextResponse.json(report);
    }

    if (action === "source-balance") {
      const report = await analyzeSourceBalance();
      return NextResponse.json(report);
    }

    if (action === "provider-coverage") {
      const report = await analyzeProviderCoverage();
      return NextResponse.json(report ?? { error: "index unreachable" });
    }

    if (action === "replay") {
      const id = searchParams.get("id")?.trim();
      if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
      const timeline = await replaySearchInteraction(id);
      if (!timeline) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json(timeline);
    }

    if (action === "eval-snippet") {
      const q = searchParams.get("q")?.trim();
      const slug = searchParams.get("taxonomy")?.trim();
      if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });
      const id = searchParams.get("id")?.trim() ?? `dir-regression-${Date.now()}`;
      const snippet = formatDirectoryEvalCaseSnippet({
        id,
        query: q,
        expectedTaxonomySlug: slug || undefined,
        notes: "Generated from search-quality admin",
      });
      return NextResponse.json({ snippet });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[admin/search-quality]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as { query?: string; limit?: number };
    const query = body.query?.trim();
    if (!query) return NextResponse.json({ error: "missing query" }, { status: 400 });
    const limit = Math.min(40, Math.max(5, Number(body.limit) || 20));
    const dir = await runRankingProbe(query, limit);
    return NextResponse.json(dir);
  } catch (e) {
    console.error("[admin/search-quality POST]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "server error" },
      { status: 500 },
    );
  }
}
