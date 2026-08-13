import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig } from "@/lib/coherence/config";
import { loadLlmOrchestrate } from "@/lib/coherence/server/agents";
import { coherenceApiGuard, requireCoherenceAccess } from "@/lib/coherence/server/guard";
import { recordUsageEvent } from "@/lib/coherence/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;
  const { apiKey, model } = coherenceOpenRouterConfig();
  return NextResponse.json({ configured: Boolean(apiKey), model, endpoint: "orchestrate" });
}

export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  let body: {
    session?: Record<string, unknown>;
    latestText?: string;
    clarifiers?: { id: string; text: string; reason: string }[];
    heuristicPrompt?: { id?: string; text?: string; reason?: string };
    frameIds?: string[];
    captchaToken?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json", fallback: true }, { status: 400 });
  }

  const access = await requireCoherenceAccess(req, {
    endpoint: "/api/coherence/llm/orchestrate",
    captchaToken: body.captchaToken,
    expectedFrontierCalls: 2,
  });
  if (access instanceof NextResponse) return access;
  const { user, requestId } = access;

  const { apiKey, model } = coherenceOpenRouterConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY not set", fallback: true },
      { status: 503 },
    );
  }

  try {
    const { orchestrateIntake } = await loadLlmOrchestrate();
    const result = await orchestrateIntake({
      session: body.session || {},
      latestText: body.latestText || "",
      clarifiers: body.clarifiers || [],
      heuristicPrompt: body.heuristicPrompt || null,
      frameIds: body.frameIds || [],
    });

    if (!result) {
      if (user.id !== "anonymous") {
        await recordUsageEvent({
          userId: user.id,
          requestId,
          endpoint: "/api/coherence/llm/orchestrate",
          status: "failed",
        });
      }
      return NextResponse.json({ error: "Orchestrate failed", fallback: true }, { status: 502 });
    }

    if (user.id !== "anonymous") {
      await recordUsageEvent({
        userId: user.id,
        requestId,
        endpoint: "/api/coherence/llm/orchestrate",
        status: "completed",
        llmCalls: 1,
      });
    }

    return NextResponse.json({
      timeline: result.timeline,
      snippets: result.snippets,
      prompt: result.prompt,
      model: result.model || model,
    });
  } catch (err) {
    if (user.id !== "anonymous") {
      await recordUsageEvent({
        userId: user.id,
        requestId,
        endpoint: "/api/coherence/llm/orchestrate",
        status: "failed",
      });
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Orchestrate error",
        fallback: true,
      },
      { status: 500 },
    );
  }
}
