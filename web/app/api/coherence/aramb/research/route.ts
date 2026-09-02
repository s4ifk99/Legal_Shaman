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
import { saveArambFreeResourceCandidates } from "@/lib/aramb/resourceBank";
import {
  arambBackendTimeoutMs,
  proxyArambResearchCollect,
  shouldProxyArambToHomeBackend,
} from "@/lib/coherence/server/gateway";
import { recordUsageEvent, releaseConcurrent } from "@/lib/coherence/usage";
import type { MatterFrame } from "@/lib/matter";
import type { ResearchSource } from "@/lib/coherence/researchBundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
// Exa search + OpenRouter synthesis — well under the old Aramb 290s wait.
const ARAMB_REQUEST_TIMEOUT_MS = 90_000;

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
  const employment = /\b(employer|employment|employee|workplace|work schedule|rota|shift|childcare|pregnan|maternity|acas|hr\b|dismiss|redundan)\b/i.test(
    text,
  );
  const activeCrime = /\b(police|arrest(?:ed)?|charged with|prosecut(?:ion|ed)|magistrates?|cps\b|offen[cs]e|driving ban|court hearing)\b/i.test(
    text,
  );
  // A prior predictive chip can leave “Criminal” in the saved narrative.
  // Do not let that isolated label displace an employment story.
  return employment && !activeCrime ? text.replace(/\bcriminal(?: law)?\b/gi, " ") : text;
}

function matchingFromFrame(frame: MatterFrame, sources: ResearchSource[]) {
  const slug = frame.primaryIssues[0]?.slug || "";
  const matterType =
    slug.startsWith("employment") || slug === "employment"
      ? "employment"
      : slug.startsWith("housing") || slug === "neighbour_dispute"
        ? "housing"
        : slug.startsWith("consumer") || slug === "parking_pcn"
          ? "consumer"
          : slug.startsWith("family")
            ? "family"
            : slug.startsWith("immigration")
              ? "immigration"
              : slug.startsWith("debt")
                ? "debt"
                : slug.startsWith("conveyancing")
                  ? "conveyancing"
                  : slug.startsWith("crime") || slug === "motoring_disqualification"
                    ? "crime"
                    : "other";
  if (!slug || !sources.length) return undefined;
  return {
    matterType,
    topicId: matterType === "employment" ? "employment" : "general",
    taxonomySlug: slug,
    confidence: frame.overallConfidence >= 0.75 ? "high" : frame.overallConfidence >= 0.5 ? "medium" : "low",
    rationale: `Legal Shaman curated matter routing identified ${slug} as the primary issue.`,
    sourceIds: sources.slice(0, 3).map((source) => source.id),
  } as const;
}

function curatedFallback(
  sources: ReturnType<typeof runScopedResearchTools>["sources"],
  reason: string,
  matching?: ReturnType<typeof matchingFromFrame>,
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
    const matterFrame = MatterEngine.resolve({
      submission,
      clientQuestion,
      understanding,
      jurisdictionHint: "",
    }).frame;
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
    const query = [
      clientQuestion || "Explore the legal research question.",
      understanding ? `Current Legal Shaman understanding: ${understanding}` : "",
      `Legal Shaman curated routing hypothesis: ${matterFrame.primaryIssues[0]?.slug || "uncertain"}. Confirm or correct this before matching help.`,
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
      matterSlug: matterFrame.primaryIssues[0]?.slug || "unknown",
      skipCache: body.skipCache === true,
    };
    const arambEnabled = arambPilotEnabled();
    const fallbackReason = arambEnabled
      ? "The Shaman could not complete the Exa open-web research phase."
      : "The Shaman is not configured (set EXA_API_KEY and ENABLE_ARAMB_PILOT); open-web research was skipped.";
    const curatedMatching = matchingFromFrame(matterFrame, scopedSources);

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
      const bundle = result.bundle.matching ? result.bundle : { ...result.bundle, matching: curatedMatching };
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
            const bundle = result.bundle.matching
              ? result.bundle
              : { ...result.bundle, matching: curatedMatching };
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
