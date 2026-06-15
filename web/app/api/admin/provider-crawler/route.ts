import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse, getAdminRuntimeMeta } from "@/lib/admin/api-response";
import { enrichAdminReviewPayload } from "@/lib/provider-crawler/admin-review";
import { loadPendingExtractedFieldsSafe } from "@/lib/provider-crawler/crawl-review-datasource";
import {
  approveGlobalValue,
  invalidateGlobalApprovalCache,
  rejectGlobalValue,
} from "@/lib/provider-enrichment/global-value-approvals";
import {
  bulkSetExtractedFieldStatus,
  countProviderExtractedFields,
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
  const pendingLoad = await loadPendingExtractedFieldsSafe(500, categoryFilter);
  const pending = pendingLoad.ok ? pendingLoad.pending : [];
  const [queuedJobs, counts, runtime, review] = await Promise.all([
    listQueuedCrawlJobs(50),
    countProviderExtractedFields(),
    Promise.resolve(getAdminRuntimeMeta()),
    pendingLoad.ok ? enrichAdminReviewPayload(pending) : Promise.resolve(null),
  ]);

  return adminJsonResponse({
    pending,
    queuedJobs,
    review,
    reviewDegraded: !pendingLoad.ok,
    reviewError: pendingLoad.ok ? undefined : pendingLoad.error,
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
    action?: "queue" | "bulk" | "globalApprove" | "globalReject";
    entityId?: string;
    entityType?: string;
    mode?: string;
    targetUrl?: string;
    ids?: string[];
    decision?: "approve" | "reject";
    fieldName?: string;
    displayValue?: string;
    normalizedValue?: string;
  };

  if (body.action === "globalApprove") {
    if (!body.fieldName || !body.normalizedValue || !body.displayValue) {
      return adminJsonResponse(
        { error: "fieldName, normalizedValue, and displayValue required for globalApprove" },
        { status: 400 },
      );
    }
    const result = await approveGlobalValue({
      fieldName: body.fieldName,
      displayValue: body.displayValue,
      normalizedValue: body.normalizedValue,
      seedIds: Array.isArray(body.ids) ? body.ids : undefined,
    });
    invalidateGlobalApprovalCache();
    return adminJsonResponse({ success: true, ...result, decision: "approve" });
  }

  if (body.action === "globalReject") {
    if (!body.fieldName || !body.normalizedValue) {
      return adminJsonResponse(
        { error: "fieldName and normalizedValue required for globalReject" },
        { status: 400 },
      );
    }
    const result = await rejectGlobalValue({
      fieldName: body.fieldName,
      normalizedValue: body.normalizedValue,
      seedIds: Array.isArray(body.ids) ? body.ids : undefined,
    });
    return adminJsonResponse({ success: true, ...result, decision: "reject" });
  }

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
    if (body.decision === "approve") invalidateGlobalApprovalCache();
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
