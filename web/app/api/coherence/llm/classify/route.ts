import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig, ensureCoherenceServerEnv } from "@/lib/coherence/config";
import { heuristicSuggestPack } from "@/lib/coherence/packClassifier";
import { classifyPackWithLlm, enablePackClassifyLlm } from "@/lib/coherence/packClassifyLlm";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;
  ensureCoherenceServerEnv();
  const { apiKey, model } = coherenceOpenRouterConfig();
  return NextResponse.json({
    configured: Boolean(apiKey) && enablePackClassifyLlm(),
    model,
    endpoint: "classify",
  });
}

export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  ensureCoherenceServerEnv();

  let body: { text?: string };
  try {
    body = (await req.json()) as { text?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const text = (body.text || "").trim();
  if (text.length < 3) {
    return NextResponse.json({ error: "text_required" }, { status: 400 });
  }

  const heuristic = heuristicSuggestPack(text);
  const classification = await classifyPackWithLlm(text, heuristic);

  return NextResponse.json({
    classification,
    heuristic,
    llm: enablePackClassifyLlm(),
  });
}
