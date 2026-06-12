import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import {
  approveSraIdentityCandidate,
  rejectSraIdentityCandidate,
} from "@/lib/sra/missing-identity-recovery/approve-candidate";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const { id } = await params;
  const body = (await req.json()) as { action?: "approve" | "reject"; reason?: string };
  if (body.action !== "approve" && body.action !== "reject") {
    return adminJsonResponse({ error: "action must be approve or reject" }, { status: 400 });
  }

  if (body.action === "reject") {
    const ok = await rejectSraIdentityCandidate(prisma, id, body.reason);
    if (!ok) return adminJsonResponse({ error: "not found" }, { status: 404 });
    return adminJsonResponse({ ok: true, status: "rejected" });
  }

  const result = await approveSraIdentityCandidate(prisma, id);
  if (!result.ok) {
    return adminJsonResponse({ error: result.error }, { status: 400 });
  }
  return adminJsonResponse({ ok: true, status: "approved", entityId: result.entityId });
}
