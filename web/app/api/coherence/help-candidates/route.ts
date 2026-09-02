import { NextResponse } from "next/server";

import { listArambHelpCandidates } from "@/lib/aramb/resourceBank";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  const url = new URL(req.url);
  const matterType = url.searchParams.get("matterType") || "";
  const resources = await listArambHelpCandidates({ matterType, limit: 16 });
  return NextResponse.json({ resources });
}
