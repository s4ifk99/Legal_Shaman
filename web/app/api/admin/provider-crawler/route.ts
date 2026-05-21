import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse, getAdminRuntimeMeta } from "@/lib/admin/api-response";
import {
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

  const [pending, queuedJobs, counts, runtime] = await Promise.all([
    listPendingExtractedFields(200, category as "field" | "testimonial" | "review_signal" | undefined),
    listQueuedCrawlJobs(50),
    countProviderExtractedFields(),
    Promise.resolve(getAdminRuntimeMeta()),
  ]);

  return adminJsonResponse({
    pending,
    queuedJobs,
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
    action?: "queue";
    entityId?: string;
    entityType?: string;
    mode?: string;
    targetUrl?: string;
  };

  if (body.action !== "queue" || !body.entityId || !body.entityType) {
    return adminJsonResponse(
      { error: "action=queue with entityId and entityType required" },
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
