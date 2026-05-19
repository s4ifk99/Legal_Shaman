import { NextResponse } from "next/server";
import { requireAdminApiRequest } from "@/lib/admin/auth";
import { listPendingEnrichments } from "@/lib/provider-enrichment/review-queue";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const pending = await listPendingEnrichments(200);
  return NextResponse.json({ pending });
}
