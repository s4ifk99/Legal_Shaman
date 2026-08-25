import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig, ensureCoherenceServerEnv } from "@/lib/coherence/config";
import { critiqueOverviewRecommendation } from "@/lib/coherence/critiqueOverview";
import { buildOverviewAnswer } from "@/lib/coherence/overviewAnswer";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import { MatterEngine } from "@/lib/matter";

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
  /** Optional: skip critic retry (tests / diagnostics). */
  skipCritiqueRetry?: boolean;
};

/** Overview: MatterEngine-scoped wiki retrieve → practical recommendation (matches local master path). */
export async function POST(req: Request) {
  const { shouldProxyCoherenceToHomeBackend, proxyCoherenceBackendPath } = await import(
    "@/lib/coherence/server/gateway"
  );
  if (shouldProxyCoherenceToHomeBackend()) {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    return proxyCoherenceBackendPath({
      path: "/api/coherence/llm/answer",
      body,
      signal: req.signal,
      timeoutMs: 90_000,
    });
  }

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

  const understanding = body.understanding ? String(body.understanding) : undefined;
  const clientQuestion = body.clientQuestion ? String(body.clientQuestion) : undefined;

  try {
    // Same MatterEngine resolve as /api/coherence/llm/master so live Overview matches local
    const matterResolved = MatterEngine.resolve({
      submission: latestText,
      clientQuestion: clientQuestion || "",
      understanding: understanding || "",
      jurisdictionHint: "",
    });
    const matterFrame = matterResolved.frame;
    const taxonomySlug = matterFrame.primaryIssues[0]?.slug ?? undefined;

    let { answerPackage, meta } = await buildOverviewAnswer({
      latestText,
      understanding,
      clientQuestion,
      matterFrame,
      taxonomySlug,
    });

    let critique = critiqueOverviewRecommendation({
      latestText,
      clientQuestion,
      understanding,
      answerPackage,
    });
    let retries = 0;
    const allowRetry =
      process.env.COHERENCE_OVERVIEW_RETRY !== "0" && !body.skipCritiqueRetry;

    if (!critique.ok && allowRetry && retries < 1) {
      retries += 1;
      const retry = await buildOverviewAnswer({
        latestText,
        understanding,
        clientQuestion,
        matterFrame,
        taxonomySlug,
        critique: critique.critique,
      });
      answerPackage = retry.answerPackage;
      meta = {
        ...retry.meta,
        overviewRetries: retries,
        priorCritique: critique.critique,
      };
      critique = critiqueOverviewRecommendation({
        latestText,
        clientQuestion,
        understanding,
        answerPackage,
      });
    }

    return NextResponse.json({
      answerPackage,
      wiki: {
        ...meta,
        matterId: matterFrame.matterId,
        primaryIssues: matterFrame.primaryIssues.map((i) => i.slug),
        critiqueOk: critique.ok,
        critique: critique.critique,
        overviewRetries: retries,
      },
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
