import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig } from "@/lib/coherence/config";
import { loadBriefAgent } from "@/lib/coherence/server/agents";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;
  const { apiKey, model } = coherenceOpenRouterConfig();
  return NextResponse.json({ configured: Boolean(apiKey), model, endpoint: "brief" });
}

export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  const { apiKey } = coherenceOpenRouterConfig();

  let body: { session?: Record<string, unknown>; latestText?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json", fallback: true }, { status: 400 });
  }

  try {
    const { understandBriefWithLlm, understandBriefHeuristic } = await loadBriefAgent();
    const latestText = body.latestText || "";
    const session = body.session || {};
    const result = apiKey
      ? await understandBriefWithLlm(latestText, session)
      : understandBriefHeuristic(latestText, session);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Brief agent error",
        fallback: true,
      },
      { status: 500 },
    );
  }
}
