import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { getOpsDashboard } from "@/lib/ops/ops-dashboard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const dashboard = await getOpsDashboard();
  return adminJsonResponse(dashboard);
}
