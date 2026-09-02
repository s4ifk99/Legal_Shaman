import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig, ensureCoherenceServerEnv } from "@/lib/coherence/config";
import { critiqueOverviewRecommendation } from "@/lib/coherence/critiqueOverview";
import { buildOverviewAnswer } from "@/lib/coherence/overviewAnswer";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";
import { MatterEngine } from "@/lib/matter";
import { KnowledgeRetriever, matterEvidenceToWikiHits } from "@/lib/matter/retrieve";
import { retrieveDworkinSnippetsForOverview } from "@/lib/coherence/overviewDworkinPack";
import { canonicalizeResearchBundle, type ResearchBundle } from "@/lib/coherence/researchBundle";
import { runScopedResearchTools } from "@/lib/aramb/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Body = {
  latestText?: string;
  understanding?: string;
  clientQuestion?: string;
  matterType?: string;
  topicId?: string;
  searchMode?: "umbra" | "penumbra";
  researchBundle?: ResearchBundle;
  frameIds?: string[];
  whatHappened?: string;
  goal?: string;
  /** Prior LexKeyPlan concepts from master / session. */
  concepts?: string[];
  session?: { matterFrame?: { concepts?: string[] } };
  followUp?: {
    kind?: "clarify" | "add_detail" | "refine";
    text?: string;
    priorAnswer?: string;
  };
  /** Optional: skip critic retry (tests / diagnostics). */
  skipCritiqueRetry?: boolean;
};

/** Overview: MatterEngine-scoped wiki retrieve → practical recommendation (matches local master path). */
export async function POST(req: Request) {
  // Always synthesise on this deployment (Vercel has the wiki index + latest ranking).
  // Do not proxy to the home tunnel — that path still ran legacy collectOverviewHits and
  // returned housing/IHT pages for belongings disputes.

  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  ensureCoherenceServerEnv();
  coherenceOpenRouterConfig();
  // Overview synthesis needs headroom — default chat client is 12s locally
  if (!process.env.LLM_TIMEOUT_MS) {
    process.env.LLM_TIMEOUT_MS = "45000";
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
    const priorConcepts = [
      ...(body.concepts || []),
      ...(body.session?.matterFrame?.concepts || []),
    ];
    const matterResolved = MatterEngine.resolve({
      submission: latestText,
      clientQuestion: clientQuestion || "",
      understanding: understanding || "",
      jurisdictionHint: "",
      agentConcepts: priorConcepts,
    });
    const matterFrame = matterResolved.frame;
    const taxonomySlug = matterFrame.primaryIssues[0]?.slug ?? undefined;
    const scopedEvidence = KnowledgeRetriever.forMatter({
      matterFrame,
      submission: latestText,
      limit: 14,
    });
    const scopedHits = matterEvidenceToWikiHits(scopedEvidence.hits);
    const scopedAuthority = retrieveDworkinSnippetsForOverview({
      query: [clientQuestion, understanding, latestText].filter(Boolean).join("\n\n"),
      taxonomySlug,
      excludeTitles: scopedHits.map((hit) => hit.title),
      limit: 8,
    });
    const canonicalSources = runScopedResearchTools(
      scopedHits,
      scopedAuthority.map((snippet) => ({
        title: snippet.title,
        url: snippet.url,
        snippet: snippet.snippet,
        dworkinKind: snippet.dworkinKind,
      })),
    ).sources;
    const researchBundle =
      body.researchBundle &&
      Array.isArray(body.researchBundle.sources) &&
      Array.isArray(body.researchBundle.claims)
      ? canonicalizeResearchBundle(body.researchBundle, canonicalSources)
      : undefined;

    let { answerPackage, meta } = await buildOverviewAnswer({
      latestText,
      understanding,
      clientQuestion,
      matterFrame,
      taxonomySlug,
      searchMode: "penumbra",
      researchBundle,
      followUp:
        body.followUp?.kind && body.followUp.text
          ? {
              kind: body.followUp.kind,
              text: String(body.followUp.text),
              priorAnswer: body.followUp.priorAnswer
                ? String(body.followUp.priorAnswer)
                : undefined,
            }
          : undefined,
    });

        let critique = critiqueOverviewRecommendation({
      latestText,
      clientQuestion,
      understanding,
      answerPackage,
      matterFrame,
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
        searchMode: "penumbra",
        researchBundle,
        critique: critique.critique,
        followUp:
          body.followUp?.kind && body.followUp.text
            ? {
                kind: body.followUp.kind,
                text: String(body.followUp.text),
                priorAnswer: body.followUp.priorAnswer
                  ? String(body.followUp.priorAnswer)
                  : undefined,
              }
            : undefined,
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
        matterFrame,
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
