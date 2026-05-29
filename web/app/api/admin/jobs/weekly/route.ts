import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { runWeeklyJobs } from "@/lib/ops/jobs-weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const result = await runWeeklyJobs({ force });
  return adminJsonResponse({
    status: result.ok ? "completed" : "failed",
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    steps: result.steps,
    errors: result.errors,
    buildId: result.buildId,
  });
}
