import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { runDailyJobs } from "@/lib/ops/jobs-daily";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const result = await runDailyJobs();
  return adminJsonResponse({
    status: result.ok ? "completed" : "failed",
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    steps: result.steps,
    errors: result.errors,
  });
}
