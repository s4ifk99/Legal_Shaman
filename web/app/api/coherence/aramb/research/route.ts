import { NextResponse } from "next/server";

import { requireCoherenceAccess } from "@/lib/coherence/server/guard";
import { MatterEngine } from "@/lib/matter";
import { KnowledgeRetriever, matterEvidenceToWikiHits } from "@/lib/matter/retrieve";
import { retrieveDworkinSnippetsForOverview } from "@/lib/coherence/overviewDworkinPack";
import { formatScopedResearchTools, runScopedResearchTools } from "@/lib/aramb/tools";
import { arambPilotEnabled, runArambResearch } from "@/lib/aramb/client";
import { saveArambFreeResourceCandidates } from "@/lib/aramb/resourceBank";
import type { MatterFrame } from "@/lib/matter";
import type { ResearchSource } from "@/lib/coherence/researchBundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const ARAMB_REQUEST_TIMEOUT_MS = 30_000;

type Body = {
  latestText?: string;
  understanding?: string;
  clientQuestion?: string;
  message?: string;
  searchMode?: "umbra" | "penumbra";
  caseKey?: string;
  conversationId?: string;
  stream?: boolean;
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

async function runWithTimeout<T>(task: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ARAMB_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const access = await requireCoherenceAccess(req, {
    endpoint: "/api/coherence/aramb/research",
    expectedFrontierCalls: 1,
    captchaToken: undefined,
    countSearch: true,
    searchKey: caseKey,
  });
  if (access instanceof NextResponse) return access;

  if (body.searchMode !== "penumbra") {
    return NextResponse.json({ error: "penumbra_required" }, { status: 400 });
  }
  const latestText = String(body.latestText || "").trim();
  const submission = researchStory(latestText);
  const message = String(body.message || "").trim();
  const caseKey = safeCaseKey(body.caseKey);
  if (latestText.length < 8 || !caseKey) {
    return NextResponse.json({ error: "missing_research_context" }, { status: 400 });
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
    limit: 14,
  });
  const hits = matterEvidenceToWikiHits(evidence.hits);
  const authority = retrieveDworkinSnippetsForOverview({
    query: [clientQuestion, understanding, submission].filter(Boolean).join("\n\n"),
    taxonomySlug: matterFrame.primaryIssues[0]?.slug,
    excludeTitles: hits.map((hit) => hit.title),
    limit: 8,
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
  };
  const arambEnabled = arambPilotEnabled();
  const fallbackReason = arambEnabled
    ? "The Shaman could not complete the configured open-web research phase."
    : "The Shaman is not configured; open-web research was skipped.";
  const curatedMatching = matchingFromFrame(matterFrame, scopedSources);

  if (!body.stream) {
    const result = arambEnabled
      ? await runWithTimeout(runArambResearch(input))
      : null;
    if (!result) {
      const bundle = curatedFallback(scopedSources, fallbackReason, curatedMatching);
      return NextResponse.json({
        conversationId: String(body.conversationId || "").trim(),
        status: bundle.status,
        questions: bundle.questions,
        bundle,
        fallback: true,
      });
    }
    await saveArambFreeResourceCandidates(result.bundle.freeResources);
    const bundle = result.bundle.matching ? result.bundle : { ...result.bundle, matching: curatedMatching };
    return NextResponse.json({
      conversationId: result.conversationId,
      status: bundle.status,
      questions: bundle.questions,
      bundle,
      latencyMs: result.latencyMs,
      tokens: result.tokens,
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
      const research = arambEnabled
        ? runWithTimeout(
            runArambResearch(input, (delta) => {
              send("progress", { characters: delta.length });
            }),
          )
        : Promise.resolve(null);
      void research.then(async (result) => {
          if (!result) {
            const bundle = curatedFallback(scopedSources, fallbackReason, curatedMatching);
            send("result", {
              conversationId: String(body.conversationId || "").trim(),
              status: bundle.status,
              questions: bundle.questions,
              bundle,
              fallback: true,
            });
          } else {
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
            });
          }
          close();
        })
        .catch(() => {
          const bundle = curatedFallback(scopedSources, fallbackReason);
          send("result", {
            conversationId: String(body.conversationId || "").trim(),
            status: bundle.status,
            questions: bundle.questions,
            bundle,
            fallback: true,
          });
          close();
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
}
