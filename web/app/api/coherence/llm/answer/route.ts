import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig, ensureCoherenceServerEnv } from "@/lib/coherence/config";
import { buildOverviewAnswer } from "@/lib/coherence/overviewAnswer";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Body = {
  latestText?: string;
  understanding?: string;
  clientQuestion?: string;
  matterType?: string;
  topicId?: string;
  frameIds?: string[];
  whatHappened?: string;
  goal?: string;
};

/** Overview: Legal Shaman wiki retrieve → practical recommendation. */
export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  ensureCoherenceServerEnv();
  coherenceOpenRouterConfig();
  // Overview synthesis needs headroom — default chat client is 12s locally
  if (!process.env.LLM_TIMEOUT_MS) {
    process.env.LLM_TIMEOUT_MS = "60000";
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const latestText = String(body.latestText || body.whatHappened || "").trim();
  if (latestText.length < 8) {
    return NextResponse.json({ error: "query_too_short" }, { status: 400 });
  }

  try {
    const { answerPackage, meta } = await buildOverviewAnswer({
      latestText,
      understanding: body.understanding,
      clientQuestion: body.clientQuestion,
    });

    return NextResponse.json({
      answerPackage,
      wiki: meta,
      origin: (answerPackage as { origin?: string }).origin || "wiki",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Answer synthesis error",
        fallback: true,
      },
      { status: 500 },
    );
  }
}
