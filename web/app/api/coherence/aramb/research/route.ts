import { NextResponse } from "next/server";

import { requireCoherenceAccess } from "@/lib/coherence/server/guard";
import { MatterEngine } from "@/lib/matter";
import { KnowledgeRetriever, matterEvidenceToWikiHits } from "@/lib/matter/retrieve";
import { retrieveDworkinSnippetsForOverview } from "@/lib/coherence/overviewDworkinPack";
import { formatScopedResearchTools, runScopedResearchTools } from "@/lib/aramb/tools";
import { arambPilotEnabled, runArambResearch, type ArambResearchOutcome } from "@/lib/aramb/client";
import {
  baseArambDiagnostic,
  logArambDiagnostic,
  type ArambResearchDiagnostic,
} from "@/lib/aramb/diagnostics";
import { saveArambFreeResourceCandidates, saveWikiLibraryCandidates } from "@/lib/aramb/resourceBank";
import {
  arambBackendTimeoutMs,
  proxyArambResearchCollect,
  shouldProxyArambToHomeBackend,
} from "@/lib/coherence/server/gateway";
import { recordUsageEvent, releaseConcurrent } from "@/lib/coherence/usage";
import type { MatterFrame } from "@/lib/matter";
import { matchingGuidanceFromFrame, preferFrameMatching } from "@/lib/coherence/issueRouting";
import { buildExaResearchBrief, cacheMatterKey } from "@/lib/penumbra/exaBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
// Finish with a fallback before Vercel's 90s platform kill.
const ARAMB_REQUEST_TIMEOUT_MS = 70_000;

/** Prefer client-committed SessionMatterFrame geometry over a fresh resolve. */
function coerceCommittedMatterFrame(
  raw: unknown,
  fallback: MatterFrame,
): MatterFrame {
  if (!raw || typeof raw !== "object") return fallback;
  const mf = raw as Partial<MatterFrame>;
  if (!Array.isArray(mf.primaryIssues) || mf.primaryIssues.length === 0) return fallback;
  return {
    ...fallback,
    matterId: typeof mf.matterId === "string" ? mf.matterId : fallback.matterId,
    primaryIssues: mf.primaryIssues,
    secondaryIssues: Array.isArray(mf.secondaryIssues) ? mf.secondaryIssues : fallback.secondaryIssues,
    exclusions: Array.isArray(mf.exclusions) ? mf.exclusions : fallback.exclusions,
    ambiguities: Array.isArray(mf.ambiguities) ? mf.ambiguities : fallback.ambiguities,
    retrievalScope: Array.isArray(mf.retrievalScope) ? mf.retrievalScope : fallback.retrievalScope,
    overallConfidence:
      typeof mf.overallConfidence === "number" ? mf.overallConfidence : fallback.overallConfidence,
    resolutionStatus: (mf.resolutionStatus as MatterFrame["resolutionStatus"]) || fallback.resolutionStatus,
    concepts: Array.isArray(mf.concepts) ? mf.concepts : fallback.concepts,
  };
}

type Body = {
  latestText?: string;
  understanding?: string;
  clientQuestion?: string;
  message?: string;
  searchMode?: "umbra" | "penumbra";
  caseKey?: string;
  conversationId?: string;
  stream?: boolean;
  /** Bypass shared Penumbra cache (admin / replay). */
  skipCache?: boolean;
};

function safeCaseKey(value: unknown): string {
  const key = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{12,120}$/.test(key) ? key : "";
}

function researchStory(text: string): string {
  const trimmed = text.trim();
  if (/^criminal(?: law)?$/i.test(trimmed)) return trimmed;
  const employment = /\b(employer|employment|employee|workplace|dismiss|redundan|acas)\b/i.test(text);
  const activeCrime = /\b(police|arrest(?:ed)?|charged with|prosecut(?:ion|ed)|magistrates?|cps\b|offen[cs]e|driving ban|court hearing)\b/i.test(
    text,
  );
  return employment && !activeCrime ? text.replace(/\bcriminal(?: law)?\b/gi, " ") : text;
}

function researchConstraints(frame: MatterFrame, clientQuestion: string): string {
  const issues = [...frame.primaryIssues, ...frame.secondaryIssues]
    .map((i) => i.slug)
    .slice(0, 6);
  const caps = frame.capacities
    .map((c) => `${c.partyId}:${c.capacity}`)
    .slice(0, 8);
  const exclusions = (frame.exclusions || []).slice(0, 8);
  return [
    `Issue graph (keep all that apply; do not collapse to one topic): ${issues.join(", ") || "uncertain"}.`,
    caps.length ? `Capacities: ${caps.join("; ")}.` : "",
    exclusions.length ? `Do not retrieve or match on excluded issues: ${exclusions.join(", ")}.` : "",
    clientQuestion ? `Answer each client question: ${clientQuestion}` : "",
    "Third Eye: run full open-web research from this brief. Do not replace the frozen primary matter with an excluded neighbouring topic.",
  ]
    .filter(Boolean)
    .join("\n");
}

function curatedFallback(
  sources: ReturnType<typeof runScopedResearchTools>["sources"],
  reason: string,
  matching?: MatchingGuidance,
) {
  return {
    mode: "penumbra" as const,
    status: "complete" as const,
    questions: [],
    sources,
    claims: [],
    conflicts: [],
    missingFacts: [reason],
    nextActions: [
      "Review the curated Legal Shaman sources and continue with matching help or a Legal Shaman synthesis.",
    ],
    matching,
    freeResources: [],
  };
}

async function runWithTimeout(
  task: Promise<ArambResearchOutcome>,
  context: { caseKey?: string; stream?: boolean; requestId?: string },
): Promise<ArambResearchOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ArambResearchOutcome>((resolve) => {
    timer = setTimeout(() => {
      const diagnostic = baseArambDiagnostic("timeout", ARAMB_REQUEST_TIMEOUT_MS, {
        timeoutMs: ARAMB_REQUEST_TIMEOUT_MS,
        errorMessage: "runPenumbraResearch exceeded server timeout",
      });
      logArambDiagnostic(diagnostic, context);
      resolve({ ok: false, diagnostic });
    }, ARAMB_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fallbackPayload(
  bundle: ReturnType<typeof curatedFallback>,
  body: Body,
  diagnostic?: ArambResearchDiagnostic,
) {
  return {
    conversationId: String(body.conversationId || "").trim(),
    status: bundle.status,
    questions: bundle.questions,
    bundle,
    fallback: true,
    ...(diagnostic ? { researchDiagnostic: diagnostic } : {}),
  };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const caseKey = safeCaseKey(body.caseKey);
  const access = await requireCoherenceAccess(req, {
    endpoint: "/api/coherence/aramb/research",
    expectedFrontierCalls: 1,
    captchaToken: undefined,
    countSearch: true,
    searchKey: caseKey,
  });
  if (access instanceof NextResponse) return access;

  const finishUsage = async (status: "completed" | "failed") => {
    if (!access.usageTracked || access.trustedGateway || access.user.id === "anonymous") return;
    releaseConcurrent(access.user.id, access.requestId);
    await recordUsageEvent({
      userId: access.user.id,
      requestId: access.requestId,
      endpoint: "/api/coherence/aramb/research",
      status,
      searchKey: caseKey,
    });
  };

  try {
    if (body.searchMode !== "penumbra") {
      await finishUsage("failed");
      return NextResponse.json({ error: "penumbra_required" }, { status: 400 });
    }
    const latestText = String(body.latestText || "").trim();
    const submission = researchStory(latestText);
    const message = String(body.message || "").trim();
    if (latestText.length < 8 || !caseKey) {
      await finishUsage("failed");
      return NextResponse.json({ error: "missing_research_context" }, { status: 400 });
    }

    if (shouldProxyArambToHomeBackend()) {
      const proxyRes = await proxyArambResearchCollect({
        body: body as Record<string, unknown>,
        requestId: access.requestId,
        timeoutMs: arambBackendTimeoutMs(),
        extraHeaders: {
          "x-coherence-trusted-internal": "1",
          "x-coherence-trusted-user-id": access.user.id,
        },
      });
      await finishUsage("completed");
      return proxyRes;
    }

    const understanding = String(body.understanding || "").trim();
    const clientQuestion = String(body.clientQuestion || "").trim();
    const resolved = MatterEngine.resolve({
      submission,
      clientQuestion,
      understanding,
      jurisdictionHint: "",
    }).frame;
    // Honor late-freeze commit from the client when present — do not re-resolve over it.
    const matterFrame = coerceCommittedMatterFrame(body.matterFrame, resolved);
    const evidence = KnowledgeRetriever.forMatter({
      matterFrame,
      submission,
      limit: 4,
    });
    const hits = matterEvidenceToWikiHits(evidence.hits);
    const authority = retrieveDworkinSnippetsForOverview({
      query: [clientQuestion, understanding, submission].filter(Boolean).join("\n\n"),
      taxonomySlug: matterFrame.primaryIssues[0]?.slug,
      excludeTitles: hits.map((hit) => hit.title),
      limit: 2,
    });
    const scopedSources = runScopedResearchTools(
      hits,
      authority.map((snippet) => ({
        title: snippet.title,
        url: snippet.url,
        snippet: snippet.snippet,
        dworkinKind: snippet.dworkinKind,
      })),
    ).sources;
    const planned = buildExaResearchBrief({
      story: submission,
      frame: matterFrame,
      clientQuestion,
    });
    const query = [
      planned.brief,
      understanding ? `Current Legal Shaman understanding: ${understanding}` : "",
      researchConstraints(matterFrame, clientQuestion),
      message ? `User response to the previous research question: ${message}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const input = {
      mode: "penumbra" as const,
      query,
      sourceContext: formatScopedResearchTools(scopedSources),
      canonicalSources: scopedSources,
      tenantKey: `${access.user.id}:${caseKey}`,
      conversationId: String(body.conversationId || "").trim() || undefined,
      matterSlug: cacheMatterKey(matterFrame),
      skipCache: body.skipCache === true,
      exaQueries: planned.queries,
      coverageSlots: planned.slots,
      story: submission,
    };
    const arambEnabled = arambPilotEnabled();
    const fallbackReason = arambEnabled
      ? "The Shaman could not complete the Exa open-web research phase."
      : "The Shaman is not configured (set EXA_API_KEY and ENABLE_ARAMB_PILOT); open-web research was skipped.";
    const curatedMatching = matchingGuidanceFromFrame(matterFrame, scopedSources);

    const researchContext = {
      caseKey,
      stream: Boolean(body.stream),
      requestId: access.requestId,
    };

    if (!body.stream) {
      const outcome = arambEnabled
        ? await runWithTimeout(runArambResearch(input), researchContext)
        : ({ ok: false, diagnostic: baseArambDiagnostic("disabled", 0) } satisfies ArambResearchOutcome);
      if (!outcome.ok) {
        const bundle = curatedFallback(scopedSources, fallbackReason, curatedMatching);
        await finishUsage("completed");
        return NextResponse.json(fallbackPayload(bundle, body, outcome.diagnostic));
      }
      const result = outcome.result;
      await saveArambFreeResourceCandidates(result.bundle.freeResources);
      await saveWikiLibraryCandidates(
        result.bundle.sources,
        matterFrame.primaryIssues[0]?.slug || "unknown",
      );
      const matching = preferFrameMatching(curatedMatching, result.bundle.matching, matterFrame);
      const bundle = { ...result.bundle, matching };
      await finishUsage("completed");
      return NextResponse.json({
        conversationId: result.conversationId,
        status: bundle.status,
        questions: bundle.questions,
        bundle,
        latencyMs: result.latencyMs,
        tokens: result.tokens,
        cacheHit: result.cacheHit === true,
        exaSource: result.exaSource,
        offlineHitCount: result.offlineHitCount,
      });
    }

    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      send("status", { status: "running" });
      const heartbeat = setInterval(() => {
        send("heartbeat", { ts: Date.now() });
      }, 25_000);
      const research = arambEnabled
        ? runWithTimeout(
            runArambResearch(input, (delta) => {
              send("progress", { characters: delta.length });
            }),
            researchContext,
          )
        : Promise.resolve({
            ok: false,
            diagnostic: baseArambDiagnostic("disabled", 0),
          } satisfies ArambResearchOutcome);
      void research.then(async (outcome) => {
          if (!outcome.ok) {
            const bundle = curatedFallback(scopedSources, fallbackReason, curatedMatching);
            send("result", fallbackPayload(bundle, body, outcome.diagnostic));
          } else {
            const result = outcome.result;
            await saveArambFreeResourceCandidates(result.bundle.freeResources);
            await saveWikiLibraryCandidates(
              result.bundle.sources,
              matterFrame.primaryIssues[0]?.slug || "unknown",
            );
            const matching = preferFrameMatching(curatedMatching, result.bundle.matching, matterFrame);
            const bundle = { ...result.bundle, matching };
            send("result", {
              conversationId: result.conversationId,
              status: bundle.status,
              questions: bundle.questions,
              bundle,
              latencyMs: result.latencyMs,
              cacheHit: result.cacheHit === true,
              exaSource: result.exaSource,
              offlineHitCount: result.offlineHitCount,
            });
          }
          close();
        })
        .catch((error) => {
          const diagnostic = baseArambDiagnostic("sdk_error", 0, {
            errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error),
          });
          logArambDiagnostic(diagnostic, researchContext);
          const bundle = curatedFallback(scopedSources, fallbackReason, curatedMatching);
          send("result", fallbackPayload(bundle, body, diagnostic));
          close();
        })
        .finally(() => {
          clearInterval(heartbeat);
          void finishUsage("completed");
        });
    },
    cancel() {
      // The browser may navigate away while Aramb is still working.
      // Ignore late progress/results instead of enqueueing into a closed stream.
      closed = true;
    },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    await finishUsage("failed");
    console.error("[aramb-pilot] research route failed:", error);
    return NextResponse.json({ error: "aramb_research_unavailable" }, { status: 502 });
  }
}
