import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import { setExtractedFieldStatus } from "@/lib/provider-crawler/review-queue";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const { id } = await params;
  const body = (await req.json()) as { action?: "approve" | "reject" };
  if (body.action !== "approve" && body.action !== "reject") {
    return adminJsonResponse({ error: "action must be approve or reject" }, { status: 400 });
  }

  const ok = await setExtractedFieldStatus(id, body.action === "approve" ? "approved" : "rejected");
  if (!ok) return adminJsonResponse({ error: "not found" }, { status: 404 });
  return adminJsonResponse({ ok: true, status: body.action === "approve" ? "approved" : "rejected" });
}
