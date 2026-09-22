import { NextResponse } from "next/server";

import { requireSearchAuthResponse } from "@/lib/auth/require-search-auth";
import { listArambHelpCandidates } from "@/lib/aramb/resourceBank";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authBlock = await requireSearchAuthResponse();
  if (authBlock) return authBlock;

  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  const url = new URL(req.url);
  const matterType = url.searchParams.get("matterType") || "";
  const resources = await listArambHelpCandidates({ matterType, limit: 16 });
  return NextResponse.json({ resources });
}
