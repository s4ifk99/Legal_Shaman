import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { loadFailedSearchReview, groupFailedSearchesByCluster } from "@/lib/search-quality/failed-search-review";
import { loadSearchQualityMetrics } from "@/lib/search-quality/metrics-dashboard";
import { analyzeLegalKnowledgeGaps, analyzeTaxonomyGaps } from "@/lib/search-quality/taxonomy-gap-analysis";
import { analyzeSourceBalance } from "@/lib/search-quality/source-balance-analysis";
import { analyzeProviderCoverage } from "@/lib/search-quality/provider-coverage-analysis";
import { replaySearchInteraction } from "@/lib/search-quality/search-replay";
import { runRankingProbe } from "@/lib/search-quality/ranking-probe";
import { buildManualCurationSuggestions } from "@/lib/search-quality/manual-curation";
import { formatDirectoryEvalCaseSnippet, formatLegalKnowledgeEvalCaseSnippet } from "@/lib/search-quality/eval-integration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") ?? "summary";

  try {
    if (action === "summary") {
      const [metrics, failedSample] = await Promise.all([
        loadSearchQualityMetrics(),
        loadFailedSearchReview({ limit: 15 }),
      ]);
      return adminJsonResponse({
        metrics,
        failedPreview: failedSample.slice(0, 8),
        suggestions: buildManualCurationSuggestions(failedSample),
      });
    }

    if (action === "failed") {
      const rows = await loadFailedSearchReview({ limit: 120 });
      return adminJsonResponse({ rows, clusters: groupFailedSearchesByCluster(rows) });
    }

    if (action === "taxonomy-gaps") {
      const report = await analyzeTaxonomyGaps();
      return adminJsonResponse(report);
    }

    if (action === "legal-knowledge-gaps") {
      const report = await analyzeLegalKnowledgeGaps();
      return adminJsonResponse(report);
    }

    if (action === "knowledge-contradictions") {
      const { listPendingContradictions } = await import("@/lib/knowledge-compiler/concept-graph");
      const rows = await listPendingContradictions(80);
      return adminJsonResponse({ rows });
    }

    if (action === "classification-gaps") {
      const { groupClassificationGapsByTaxonomy, loadClassificationGaps } = await import(
        "@/lib/legal-knowledge/classification-gaps"
      );
      const rows = await loadClassificationGaps(80);
      return adminJsonResponse({
        rows,
        clusters: groupClassificationGapsByTaxonomy(rows),
      });
    }

    if (action === "source-balance") {
      const report = await analyzeSourceBalance();
      return adminJsonResponse(report);
    }

    if (action === "provider-coverage") {
      const report = await analyzeProviderCoverage();
      return adminJsonResponse(report ?? { error: "index unreachable" });
    }

    if (action === "replay") {
      const id = searchParams.get("id")?.trim();
      if (!id) return adminJsonResponse({ error: "missing id" }, { status: 400 });
      const timeline = await replaySearchInteraction(id);
      if (!timeline) return adminJsonResponse({ error: "not found" }, { status: 404 });
      return adminJsonResponse(timeline);
    }

    if (action === "eval-snippet") {
      const q = searchParams.get("q")?.trim();
      const slug = searchParams.get("taxonomy")?.trim();
      if (!q) return adminJsonResponse({ error: "missing q" }, { status: 400 });
      const id = searchParams.get("id")?.trim() ?? `dir-regression-${Date.now()}`;
      const channel = searchParams.get("channel")?.trim();
      const snippet =
        channel === "legal_knowledge"
          ? formatLegalKnowledgeEvalCaseSnippet({
              id: id.replace(/^dir-/, "lk-"),
              query: q,
              expectTaxonomySlug: slug || undefined,
              notes: "Generated from search-quality admin",
            })
          : formatDirectoryEvalCaseSnippet({
              id,
              query: q,
              expectedTaxonomySlug: slug || undefined,
              notes: "Generated from search-quality admin",
            });
      return adminJsonResponse({ snippet });
    }

    return adminJsonResponse({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[admin/search-quality]", e);
    return adminJsonResponse(
      { error: e instanceof Error ? e.message : "server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as {
      query?: string;
      limit?: number;
      action?: string;
      id?: string;
      status?: "resolved" | "ignored";
    };

    if (body.action === "resolve-contradiction") {
      const id = body.id?.trim();
      const status = body.status;
      if (!id || (status !== "resolved" && status !== "ignored")) {
        return adminJsonResponse({ error: "missing id or status" }, { status: 400 });
      }
      const { resolveContradiction } = await import("@/lib/knowledge-compiler/concept-graph");
      await resolveContradiction(id, status);
      return adminJsonResponse({ ok: true });
    }

    const query = body.query?.trim();
    if (!query) return adminJsonResponse({ error: "missing query" }, { status: 400 });
    const limit = Math.min(40, Math.max(5, Number(body.limit) || 20));
    const dir = await runRankingProbe(query, limit);
    return adminJsonResponse(dir);
  } catch (e) {
    console.error("[admin/search-quality POST]", e);
    return adminJsonResponse(
      { error: e instanceof Error ? e.message : "server error" },
      { status: 500 },
    );
  }
}
