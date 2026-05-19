import { NextResponse } from "next/server";
import { requireAdminApiRequest } from "@/lib/admin/auth";
import { setEnrichmentStatus } from "@/lib/provider-enrichment/review-queue";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const { id } = await params;
  const body = (await req.json()) as { action?: "approve" | "reject" };
  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }
  const ok = await setEnrichmentStatus(id, body.action === "approve" ? "approved" : "rejected");
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status: body.action === "approve" ? "approved" : "rejected" });
}
