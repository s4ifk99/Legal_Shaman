import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { runRefreshApprovedJobs } from "@/lib/ops/jobs-refresh-approved";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const result = await runRefreshApprovedJobs({ limit: 100 });
  return adminJsonResponse({
    status: result.ok ? "completed" : "failed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    steps: [
      {
        name: "refresh-approved",
        ok: result.ok,
        detail: `processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed}`,
      },
    ],
    errors: result.errors,
  });
}
