import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig } from "@/lib/coherence/config";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;
  const { apiKey, model } = coherenceOpenRouterConfig();
  return NextResponse.json({ configured: Boolean(apiKey), model });
}
