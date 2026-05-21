import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { listPendingEnrichments } from "@/lib/provider-enrichment/review-queue";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const pending = await listPendingEnrichments(200);
  return adminJsonResponse({ pending });
}
