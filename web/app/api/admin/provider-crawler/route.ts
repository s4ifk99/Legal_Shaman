import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse, getAdminRuntimeMeta } from "@/lib/admin/api-response";
import { enrichAdminReviewPayload } from "@/lib/provider-crawler/admin-review";
import {
  bulkSetExtractedFieldStatus,
  countProviderExtractedFields,
  listPendingExtractedFields,
  listQueuedCrawlJobs,
  queueCrawlJob,
} from "@/lib/provider-crawler/review-queue";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const category = url.searchParams.get("reviewCategory") ?? undefined;

  const categoryFilter = category as "field" | "testimonial" | "review_signal" | undefined;
  const pending = await listPendingExtractedFields(500, categoryFilter);
  const [queuedJobs, counts, runtime, review] = await Promise.all([
    listQueuedCrawlJobs(50),
    countProviderExtractedFields(),
    Promise.resolve(getAdminRuntimeMeta()),
    enrichAdminReviewPayload(pending),
  ]);

  return adminJsonResponse({
    pending,
    queuedJobs,
    review,
    meta: {
      dbRowCount: counts.total,
      pendingRowCount: counts.pending,
      environment: runtime.environment,
      vercelEnv: runtime.vercelEnv,
      nodeEnv: runtime.nodeEnv,
      databaseHost: runtime.databaseHost,
      serverFetchedAt: runtime.fetchedAt,
    },
  });
}

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const body = (await req.json()) as {
    action?: "queue" | "bulk";
    entityId?: string;
    entityType?: string;
    mode?: string;
    targetUrl?: string;
    ids?: string[];
    decision?: "approve" | "reject";
  };

  if (body.action === "bulk") {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
    if (ids.length === 0) {
      return adminJsonResponse({ error: "ids required for bulk action" }, { status: 400 });
    }
    if (body.decision !== "approve" && body.decision !== "reject") {
      return adminJsonResponse({ error: "decision must be approve or reject" }, { status: 400 });
    }
    const status = body.decision === "approve" ? "approved" : "rejected";
    const result = await bulkSetExtractedFieldStatus(ids, status);
    return adminJsonResponse({ success: true, ...result, decision: body.decision });
  }

  if (body.action !== "queue" || !body.entityId || !body.entityType) {
    return adminJsonResponse(
      { error: "action=queue with entityId and entityType, or action=bulk with ids and decision" },
      { status: 400 },
    );
  }

  const id = await queueCrawlJob(
    body.entityId,
    body.entityType,
    body.mode ?? "all",
    body.targetUrl,
  );
  if (!id) return adminJsonResponse({ error: "queue failed" }, { status: 500 });
  return adminJsonResponse({ ok: true, jobId: id });
}
