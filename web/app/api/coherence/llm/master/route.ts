/**
 * Master orchestrator route — matter_resolution primary path.
 */
import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig, ensureCoherenceServerEnv } from "@/lib/coherence/config";
import { critiqueOverviewRecommendation } from "@/lib/coherence/critiqueOverview";
import {
  beginLlmBudget,
  endLlmBudget,
  formatLlmTrace,
} from "@/lib/coherence/llm-budget";
import { toSessionMatterFrame } from "@/lib/coherence/matterFrame";
import { buildOverviewAnswer } from "@/lib/coherence/overviewAnswer";
import type { ResearchBundle } from "@/lib/coherence/researchBundle";
import { loadMasterOrchestrate, loadAgents } from "@/lib/coherence/server/agents";
import { coherenceApiGuard, requireCoherenceAccess } from "@/lib/coherence/server/guard";
import {
  recordUsageEvent,
  releaseConcurrent,
  summarizeLlmTrace,
} from "@/lib/coherence/usage";
import { formatMatterInspector } from "@/lib/matter/inspector";
import { MatterEngine } from "@/lib/matter/resolve";
import type { AnswerPackage } from "@/lib/coherence/answerPackage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type MasterResult = {
  runId?: string;
  finalOk?: boolean;
  brief?: {
    understanding?: string;
    clientQuestion?: string;
    whatHappened?: string;
    matterType?: string;
    topicId?: string;
  };
  classify?: {
    matterType?: string;
    topicId?: string;
    taxonomySlug?: string;
    taxonomyConfidence?: string;
  };
  taxonomy?: { taxonomySlug?: string; confidence?: string; reason?: string };
  answerPackage?: AnswerPackage | null;
  critiques?: { step: string; ok: boolean; errors?: string[]; critique?: string }[];
  agents?: { name: string; [k: string]: unknown }[];
  [k: string]: unknown;
};

function matterResolutionEnabled(): boolean {
  return process.env.COHERENCE_MATTER_RESOLUTION !== "0";
}

function legacyShadowEnabled(): boolean {
  return process.env.COHERENCE_LEGACY_SHADOW === "1";
}

export async function GET() {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;
  const { apiKey, model } = coherenceOpenRouterConfig();
  return NextResponse.json({
    configured: Boolean(apiKey),
    model,
    endpoint: "master",
    matterResolution: matterResolutionEnabled(),
    legacyShadow: legacyShadowEnabled(),
  });
}

/**
 * Master orchestrator:
 * matter_resolution (#1) → MatterEngine.resolve → deterministic pipeline → final_synthesis (#2)
 *
 * Legacy Brief/Taxonomy/Ask/Answer LLM calls are skipped on the resolution path.
 * Optional COHERENCE_LEGACY_SHADOW=1 compares against heuristic legacy (no extra LLM cost).
 */
export async function POST(req: Request) {
  // Production cutover: never run the orchestrator on Vercel — forward to home via gateway.
  const { shouldProxyCoherenceToHomeBackend } = await import("@/lib/coherence/server/gateway");
  if (shouldProxyCoherenceToHomeBackend()) {
    const { POST: gatewayPost } = await import("@/app/api/coherence/query/route");
    return gatewayPost(req);
  }

  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  ensureCoherenceServerEnv();
  coherenceOpenRouterConfig();
  if (!process.env.LLM_TIMEOUT_MS) {
    process.env.LLM_TIMEOUT_MS = "60000";
  }

  let body: {
    session?: Record<string, unknown>;
    latestText?: string;
    heuristicPrompt?: { id?: string; text?: string; reason?: string };
    frameIds?: string[];
    mode?: "intake" | "answer";
    searchMode?: "umbra" | "penumbra";
    followUp?: {
      kind?: "clarify" | "add_detail" | "refine";
      text?: string;
      priorAnswer?: string;
    };
    captchaToken?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json", fallback: true }, { status: 400 });
  }
  const searchKey =
    Array.isArray(body.session?.rawInputs) && typeof body.session.rawInputs[0] === "string"
      ? body.session.rawInputs[0]
      : body.latestText;

  const access = await requireCoherenceAccess(req, {
    endpoint: "/api/coherence/llm/master",
    captchaToken: body.captchaToken,
    expectedFrontierCalls: 2,
    countSearch: true,
    searchKey,
  });
  if (access instanceof NextResponse) return access;
  const { user, requestId: accessRequestId, trustedGateway } = access;

  // Vercel → tunnel calls: finish intake without blocking on overview LLM.
  // Client builds the wiki recommendation via /api/coherence/llm/answer afterward.
  const deferOverview =
    Boolean(trustedGateway) && (body.mode || "intake") === "intake";

  const latestText = String(body.latestText || "").trim();
  const budget = beginLlmBudget({
    requestId: accessRequestId,
  });

  try {
    const { runHelpMatchAgent, runMatterResolutionAgent } = await loadAgents();
    const { masterOrchestrate } = await loadMasterOrchestrate();

    let matterResolution: Record<string, unknown> | null = null;
    let brief: MasterResult["brief"] & Record<string, unknown>;
    let taxonomy: Record<string, unknown>;

    if (matterResolutionEnabled()) {
      matterResolution = (await runMatterResolutionAgent({
        latestText,
        session: body.session || {},
      })) as Record<string, unknown>;
      brief = matterResolution.brief as typeof brief;
      taxonomy = matterResolution.taxonomy as Record<string, unknown>;
    } else {
      const { runBriefAgent, runTaxonomyAgent } = await loadAgents();
      brief = (await runBriefAgent({
        latestText,
        session: body.session || {},
      })) as typeof brief;
      taxonomy = await runTaxonomyAgent({ latestText, brief });
    }

    const understanding = String(brief.understanding || "");
    const clientQuestion = String(brief.clientQuestion || "");
    const story =
      latestText ||
      String(brief.whatHappened || "") ||
      String((body.session as { whatHappened?: string } | undefined)?.whatHappened || "");

    const agentMf = matterResolution?.matterFrame as
      | { concepts?: string[] }
      | undefined;
    const agentTaxonomy = taxonomy as { searchBoostTerms?: string[] } | null;
    const matterResolved = MatterEngine.resolve({
      submission: story,
      clientQuestion,
      understanding,
      brief: brief as Record<string, unknown>,
      taxonomy: taxonomy as Record<string, unknown>,
      agentConcepts: [
        ...(agentMf?.concepts || []),
        ...(agentTaxonomy?.searchBoostTerms || []),
      ],
      jurisdictionHint: String(
        (body.session as { locationHint?: string } | undefined)?.locationHint || "",
      ),
    });

    // Shadow comparison — heuristic legacy, no production impact, no extra LLM by default
    let shadowCompare: Record<string, unknown> | null = null;
    if (legacyShadowEnabled() && matterResolution) {
      try {
        const { compareMatterResolutionShadow } = await importAgent<{ compareMatterResolutionShadow: Function }>(
          "matter-shadow-compare.mjs",
        );
        const { understandBriefHeuristic } = await importAgent<{ understandBriefHeuristic: Function }>(
          "brief-agent.mjs",
        );
        const { resolveTaxonomyFromStory } = await importAgent<{ resolveTaxonomyFromStory: Function }>(
          "taxonomy-resolve.mjs",
        );
        const legacyBrief = understandBriefHeuristic(story, body.session || {});
        const legacyTaxonomy = resolveTaxonomyFromStory({
          latestText: story,
          clientQuestion: legacyBrief.clientQuestion || "",
          understanding: legacyBrief.understanding || "",
        });
        const legacyFrame = MatterEngine.resolve({
          submission: story,
          clientQuestion: legacyBrief.clientQuestion || "",
          understanding: legacyBrief.understanding || "",
          brief: legacyBrief,
          taxonomy: legacyTaxonomy,
        });
        shadowCompare = compareMatterResolutionShadow(matterResolution, {
          matterFrame: legacyFrame.frame,
          brief: legacyBrief,
          taxonomy: legacyTaxonomy,
        }) as Record<string, unknown>;
        if (process.env.NODE_ENV !== "production") {
          console.info("[matter-shadow]", shadowCompare.summary);
        }
      } catch (err) {
        console.warn("[matter-shadow] compare failed:", err);
      }
    }

    const result = (await masterOrchestrate({
      session: body.session || {},
      latestText,
      heuristicPrompt: body.heuristicPrompt || null,
      frameIds: body.frameIds || [],
      mode: body.mode || "intake",
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
      maxAnswerRetries: body.mode === "answer" ? 2 : 1,
      brief,
      taxonomy,
      matterFrame: matterResolved.frame,
      matterResolution,
      researchPlan: matterResolution?.researchPlan || null,
      skipLegacyLlm: Boolean(matterResolution),
    })) as MasterResult;

    // Deterministic pack from orchestrate is not the product overview — wait for final_synthesis.
    result.answerPackage = null;

    result.matterResolution = matterResolution;
    result.researchPlan = matterResolution?.researchPlan || null;
    result.shadowCompare = shadowCompare;
    result.matterFrame = toSessionMatterFrame(matterResolved.frame);
    result.matterDiagnostics = {
      ...matterResolved.diagnostics,
      legacyDetectorChanged: Boolean(result.legacyDetectorChanged),
      resolutionDecision: matterResolution?.decision || null,
      resolutionConfidence: matterResolution?.confidence || null,
    };
    result.matterInspector = formatMatterInspector(matterResolved.frame);
    if (process.env.NODE_ENV !== "production") {
      console.info("[matter-engine]\n" + result.matterInspector.text);
      if (result.legacyDetectorChanged) {
        console.info("[matter-engine] legacy detector disagreed with MatterFrame");
      }
    }

    try {
      const classify = result.classify as {
        topicId?: string;
        matterType?: string;
        taxonomySlug?: string;
      };
      const briefLoc = brief as { locationHint?: string; jurisdiction?: string };
      const helpMatch = await runHelpMatchAgent({
        topicId: classify?.topicId,
        matterType: classify?.matterType,
        taxonomySlug: matterResolved.frame.primaryIssues[0]?.slug ?? classify?.taxonomySlug,
        matterFrame: matterResolved.frame,
        latestText: story,
        locationHint:
          briefLoc.locationHint ||
          String((body.session as { locationHint?: string } | undefined)?.locationHint || ""),
        jurisdiction:
          briefLoc.jurisdiction ||
          String((body.session as { jurisdiction?: string } | undefined)?.jurisdiction || "Unknown"),
      });
      result.helpMatch = helpMatch;
      const agents = Array.isArray(result.agents) ? [...result.agents] : [];
      const idx = agents.findIndex((a) => a.name === "helpMatch");
      const helpAgent = {
        name: "helpMatch",
        free: (helpMatch.freeHelp as unknown[] | undefined)?.length || 0,
        solicitors: (helpMatch.solicitors as unknown[] | undefined)?.length || 0,
        directories: (helpMatch.directories as unknown[] | undefined)?.length || 0,
        sraHits: (helpMatch.sra as { hitCount?: number } | undefined)?.hitCount || 0,
        sraReachable: Boolean((helpMatch.sra as { reachable?: boolean } | undefined)?.reachable),
        taxonomySlug: helpMatch.taxonomySlug || matterResolved.frame.primaryIssues[0]?.slug,
        matterFrame: true,
      };
      if (idx >= 0) agents[idx] = helpAgent;
      else agents.push(helpAgent);
      result.agents = agents;
    } catch (err) {
      console.warn("[matter-engine] helpMatch re-run failed:", err);
    }

    let overviewMeta: Record<string, unknown> | null = null;
    let overviewPack: AnswerPackage | null = null;
    let overviewRetries = 0;

    if (
      !deferOverview &&
      story.length >= 8 &&
      matterResolution?.decision?.canProceed !== false
    ) {
      try {
        const sessionResearch = body.session?.penumbraResearch as { bundle?: ResearchBundle } | undefined
        const first = await buildOverviewAnswer({
          latestText: story,
          understanding,
          clientQuestion,
          matterFrame: matterResolved.frame,
          taxonomySlug: matterResolved.frame.primaryIssues[0]?.slug ?? undefined,
          searchMode: "penumbra",
          researchBundle: sessionResearch?.bundle,
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
        overviewPack = first.answerPackage;
        overviewMeta = first.meta;

        let cOverview = critiqueOverviewRecommendation({
          latestText: story,
          clientQuestion,
          understanding,
          answerPackage: overviewPack,
          matterFrame: matterResolved.frame,
        });
        const critiques = Array.isArray(result.critiques) ? [...result.critiques] : [];
        critiques.push({
          step: "overview",
          ok: cOverview.ok,
          errors: cOverview.errors,
          critique: cOverview.critique,
        });

        // Skip slow second synthesis pass on production cutover path.
        const allowRetry = process.env.COHERENCE_OVERVIEW_RETRY !== "0" && !trustedGateway;
        if (!cOverview.ok && overviewRetries < 1 && allowRetry) {
          overviewRetries += 1;
          const retry = await buildOverviewAnswer({
            latestText: story,
            understanding,
            clientQuestion,
            critique: cOverview.critique,
            matterFrame: matterResolved.frame,
            taxonomySlug: matterResolved.frame.primaryIssues[0]?.slug ?? undefined,
            searchMode: "penumbra",
            researchBundle: sessionResearch?.bundle,
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
          overviewPack = retry.answerPackage;
          overviewMeta = { ...retry.meta, retry: true, priorCritique: cOverview.critique };
          cOverview = critiqueOverviewRecommendation({
            latestText: story,
            clientQuestion,
            understanding,
            answerPackage: overviewPack,
            matterFrame: matterResolved.frame,
          });
          critiques.push({
            step: "overview-retry",
            ok: cOverview.ok,
            errors: cOverview.errors,
            critique: cOverview.critique,
          });
        }

        result.critiques = critiques;
        if (overviewPack) {
          result.answerPackage = overviewPack;
        }
        result.overview = {
          meta: overviewMeta,
          critiqueOk: cOverview.ok,
          retries: overviewRetries,
        };
        result.agents = [
          ...(result.agents || []),
          {
            name: "overview",
            origin: (overviewPack as { origin?: string } | null)?.origin || null,
            pack: overviewPack?.matchedTopicId || null,
            critiqueOk: cOverview.ok,
            retries: overviewRetries,
            pages: overviewPack?.wikiPages?.length || 0,
          },
        ];

        if (typeof result.finalOk === "boolean") {
          result.finalOk = result.finalOk && cOverview.ok;
        }
      } catch (err) {
        const critiques = Array.isArray(result.critiques) ? [...result.critiques] : [];
        critiques.push({
          step: "overview",
          ok: false,
          errors: [err instanceof Error ? err.message : "overview failed"],
          critique: "overview synthesis failed",
        });
        result.critiques = critiques;
        result.agents = [
          ...(result.agents || []),
          {
            name: "overview",
            error: err instanceof Error ? err.message : "overview failed",
          },
        ];
      }
    } else if (deferOverview) {
      result.answerPackage = null;
      result.overview = {
        deferred: true,
        reason: "client_synthesises_after_intake",
      };
      result.agents = [
        ...(result.agents || []),
        { name: "overview", deferred: true },
      ];
    } else if (matterResolution?.decision?.needsClarification) {
      result.overview = {
        skipped: true,
        reason: "matter_resolution needs clarification before synthesis",
        clarificationQuestion: matterResolution.decision?.clarificationQuestion,
      };
    }

    const closed = endLlmBudget() || budget;
    result.llmTrace = {
      requestId: closed.requestId,
      callsUsed: closed.callsUsed,
      normalMax: closed.normalMax,
      exceptionalMax: closed.exceptionalMax,
      maxCalls: closed.maxCalls,
      hard: closed.hard,
      overNormal: closed.callsUsed > closed.normalMax,
      overExceptional: closed.callsUsed > closed.exceptionalMax,
      records: closed.records,
      text: formatLlmTrace(closed),
    };
    if (process.env.NODE_ENV !== "production") {
      console.info(String(result.llmTrace.text));
    }

    if (user.id !== "anonymous" && !trustedGateway) {
      const summary = summarizeLlmTrace(closed.records);
      await recordUsageEvent({
        userId: user.id,
        requestId: accessRequestId,
        endpoint: "/api/coherence/llm/master",
        status: "completed",
        ...summary,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    endLlmBudget();
    if (user.id !== "anonymous" && !trustedGateway) {
      await recordUsageEvent({
        userId: user.id,
        requestId: accessRequestId,
        endpoint: "/api/coherence/llm/master",
        status: "failed",
      });
    } else if (!trustedGateway) {
      releaseConcurrent(user.id, accessRequestId);
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Master orchestrate error",
        fallback: true,
      },
      { status: 500 },
    );
  }
}

async function importAgent<T>(file: string): Promise<T> {
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const href = pathToFileURL(
    path.join(process.cwd(), "lib/coherence/server-scripts/lib", file),
  ).href;
  const load = new Function("u", "return import(u)") as (u: string) => Promise<T>;
  return load(href);
}
