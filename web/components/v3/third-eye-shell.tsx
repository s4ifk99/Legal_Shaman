"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { ThirdEyeInput } from "@/components/v3/third-eye-input";
import { ActionPlanView } from "@/components/v3/action-plan-view";
import { RothkoField } from "@/components/v3/rothko-field";
import {
  advanceFlow,
  applyDocumentBrief,
  applyExplanation,
  createInitialFlow,
  localOptionsExplanation,
  shamanPromptForPhase,
  typingDelayMs,
  type FlowMessage,
  type FlowState,
} from "@/lib/cases/flow";
import type { CaseRecord } from "@/lib/cases/types";
import type { DocumentBrief } from "@/lib/cases/document-brief";
import { freeServicesForKind } from "@/lib/cases/free-services";
import {
  CASE_SNAPSHOT_KEY,
  clearFlowResume,
  consumeResultsIntent,
  loadFlowResume,
  markResultsIntent,
  saveFlowResume,
} from "@/lib/cases/flow-resume";
import { validateUploadFile } from "@/lib/cases/upload-safety";
import { resolveApiUrl } from "@/lib/site/api-url";

const PERSIST_MS = 12_000;
const EXPLAIN_MS = 45_000;

function saveCaseSnapshot(state: FlowState) {
  try {
    const kind = state.disputeKind || state.answers.disputeKind || null;
    const plan = state.actionPlan
      ? {
          ...state.actionPlan,
          freeServices:
            state.actionPlan.freeServices?.length
              ? state.actionPlan.freeServices
              : freeServicesForKind(kind, state.answers.disputeStory || state.summary),
        }
      : null;
    sessionStorage.setItem(
      CASE_SNAPSHOT_KEY,
      JSON.stringify({
        title: state.title,
        summary: state.summary,
        matterType: kind,
        fundingPreference: state.fundingPreference,
        actionPlan: plan,
        profileAnswers: state.answers,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* ignore quota */
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function persistCase(state: FlowState, caseId: string | null): Promise<string | null> {
  try {
    const res = await fetch(resolveApiUrl("/api/cases"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: caseId || undefined,
        title: state.title || "Your situation",
        summary: state.summary || state.answers.disputeStory || null,
        matterType: state.disputeKind || state.answers.disputeKind || null,
        locationHint: state.answers.solicitorLocation || null,
        status: state.actionPlan ? "exploring" : "open",
        fundingKnowledge: state.fundingKnowledge,
        fundingPreference: state.fundingPreference,
        fundingNotes: state.fundingNotes || null,
        profileAnswers: state.answers,
        actionPlan: state.actionPlan,
        sessionSnapshot: {
          whatHappened: state.answers.disputeStory || state.summary,
          goal: state.title,
          disputeKind: state.disputeKind || state.answers.disputeKind,
          disputeAnswers: state.answers.disputeAnswers,
          optionsExplanation: state.optionsExplanation,
          legalAidAnswers: state.answers.legalAidAnswers,
          legalAidLikelihood: state.answers.legalAidLikelihood,
          wantSpeakToSomeone: state.answers.wantSpeakToSomeone,
          solicitorMatchMode: state.answers.solicitorMatchMode,
          solicitorLocation: state.answers.solicitorLocation,
          freeServicesTried: state.answers.freeServicesTried,
          flowPhase: state.phase,
          messages: state.messages.slice(-40),
        },
      }),
    });
    if (!res.ok) return caseId;
    const data = (await res.json()) as { case: CaseRecord };
    return data.case.id;
  } catch {
    return caseId;
  }
}

async function fetchExplanation(state: FlowState): Promise<string[]> {
  try {
    const res = await fetch(resolveApiUrl("/api/cases/explain"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: state.disputeKind || state.answers.disputeKind || "general",
        story: state.answers.disputeStory || state.summary || state.title,
        disputeAnswers: state.answers.disputeAnswers || {},
      }),
    });
    if (!res.ok) return localOptionsExplanation(state);
    const data = (await res.json()) as {
      explanationMessages?: string[];
      explanationText?: string;
    };
    if (data.explanationMessages?.length) return data.explanationMessages;
    if (data.explanationText?.trim()) {
      return data.explanationText
        .split(/\n\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return localOptionsExplanation(state);
  } catch {
    return localOptionsExplanation(state);
  }
}

/** Render markdown-style [Source](url) and bare https links in chat. */
function ChatText({ text, isYou }: { text: string; isYou: boolean }) {
  const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        const md = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        if (md) {
          return (
            <a
              key={i}
              href={md[2]}
              target="_blank"
              rel="noopener noreferrer"
              className={
                isYou
                  ? "underline decoration-white/70 underline-offset-2 hover:decoration-white"
                  : "font-medium text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
              }
            >
              {md[1]}
            </a>
          );
        }
        if (/^https?:\/\//.test(part)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className={
                isYou
                  ? "underline decoration-white/70 underline-offset-2 hover:decoration-white"
                  : "font-medium text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
              }
            >
              Source
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function stripTrailingShaman(state: FlowState, count: number): FlowState {
  if (count <= 0) return state;
  const msgs = [...state.messages];
  let removed = 0;
  for (let i = msgs.length - 1; i >= 0 && removed < count; i -= 1) {
    if (msgs[i]?.role === "shaman") {
      msgs.splice(i, 1);
      removed += 1;
    }
  }
  return { ...state, messages: msgs };
}

function appendShaman(state: FlowState, text: string): FlowState {
  const msg: FlowMessage = {
    id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: "shaman",
    text,
  };
  return { ...state, messages: [...state.messages, msg] };
}

function withPlanServices(state: FlowState): FlowState {
  if (!state.actionPlan) return state;
  const kind = state.disputeKind || state.answers.disputeKind || null;
  const story = state.answers.disputeStory || state.summary || "";
  return {
    ...state,
    actionPlan: {
      ...state.actionPlan,
      freeServices: state.actionPlan.freeServices?.length
        ? state.actionPlan.freeServices
        : freeServicesForKind(kind, story),
    },
  };
}

async function enrichPlanServices(state: FlowState): Promise<FlowState> {
  if (!state.actionPlan) return state;
  const kind = state.disputeKind || state.answers.disputeKind || null;
  const story = state.answers.disputeStory || state.summary || state.title || "";
  let next = withPlanServices(state);

  try {
    const res = await fetch(resolveApiUrl("/api/cases/recommend-services"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, story }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        services?: Array<{ id: string; name: string; blurb: string; url?: string; phone?: string }>;
      };
      if (data.services?.length && next.actionPlan) {
        next = {
          ...next,
          actionPlan: { ...next.actionPlan, freeServices: data.services },
        };
      }
    }
  } catch {
    /* keep baseline free services */
  }

  // Solicitors stay opt-in in the plan UI ("If these don’t help, look for a solicitor")
  // so free services remain the first answer when someone only wants free advice.
  if (next.actionPlan) {
    next = {
      ...next,
      actionPlan: {
        ...next.actionPlan,
        matchedSolicitors: [],
        solicitorMatchMode: undefined,
        solicitorLocation: null,
      },
    };
  }

  return next;
}

export function ThirdEyeShell() {
  const router = useRouter();
  const { user, loading, openAuth } = useBookmarks();
  const [flow, setFlow] = useState<FlowState>(() => createInitialFlow(true));
  const [caseId, setCaseId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [rothkoPulse, setRothkoPulse] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const flowRef = useRef(flow);
  const caseIdRef = useRef(caseId);
  const submittingRef = useRef(false);
  const pendingPromptRef = useRef<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const signedIn = Boolean(user);
  const wasSignedIn = useRef(false);

  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);

  useEffect(() => {
    caseIdRef.current = caseId;
  }, [caseId]);

  // Restore in-progress chat (guest or returning user).
  useEffect(() => {
    const resumed = loadFlowResume();
    const onlyWelcome =
      resumed?.state &&
      resumed.state.phase === "collect_story" &&
      resumed.state.messages.filter((m) => m.role === "you").length === 0;
    if (resumed?.state && !onlyWelcome) {
      setFlow(resumed.state);
      flowRef.current = resumed.state;
      if (resumed.caseId) {
        setCaseId(resumed.caseId);
        caseIdRef.current = resumed.caseId;
      }
    } else {
      const fresh = createInitialFlow(true);
      setFlow(fresh);
      flowRef.current = fresh;
    }
    setHydrated(true);
  }, []);

  // After login: keep chat, sync to server, honour “open results” intent.
  useEffect(() => {
    if (loading || !hydrated) return;
    if (signedIn && !wasSignedIn.current) {
      wasSignedIn.current = true;
      const live = flowRef.current;
      saveFlowResume(live, caseIdRef.current);
      if (live.phase !== "collect_story" || live.messages.length > 1) {
        void (async () => {
          setStatus("Saving your chat…");
          const id =
            (await withTimeout(persistCase(live, caseIdRef.current), PERSIST_MS, caseIdRef.current)) ||
            caseIdRef.current;
          if (id) {
            setCaseId(id);
            caseIdRef.current = id;
            saveFlowResume(live, id);
          }
          if (live.actionPlan) saveCaseSnapshot(live);
          setStatus(null);
          if (consumeResultsIntent()) {
            router.push("/my-case");
          }
        })();
      } else if (consumeResultsIntent()) {
        router.push("/my-case");
      }
    }
    if (!signedIn) wasSignedIn.current = false;
  }, [loading, signedIn, hydrated, router]);

  useEffect(() => {
    if (!hydrated) return;
    saveFlowResume(flow, caseId);
  }, [flow, caseId, hydrated]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [flow.messages.length, typing]);

  const revealBurst = useCallback(async (base: FlowState, burst: string[]) => {
    let live = stripTrailingShaman(base, burst.length);
    setFlow(live);
    flowRef.current = live;
    for (const line of burst) {
      setTyping(true);
      await sleep(typingDelayMs(line));
      setTyping(false);
      live = appendShaman(live, line);
      setFlow(live);
      flowRef.current = live;
      setRothkoPulse((n) => n + 1);
    }
    return live;
  }, []);

  const runExplain = useCallback(
    async (state: FlowState, id: string | null) => {
      setStatus("Putting options together…");
      setTyping(true);
      const explanation = await withTimeout(
        fetchExplanation(state),
        EXPLAIN_MS,
        localOptionsExplanation(state),
      );
      setTyping(false);
      const next = applyExplanation(state, explanation);
      const burst: string[] = [];
      for (let i = state.messages.length; i < next.messages.length; i += 1) {
        const m = next.messages[i];
        if (m?.role === "shaman") burst.push(m.text);
      }
      const revealed = await revealBurst(
        { ...next, messages: state.messages },
        burst.length ? burst : explanation,
      );
      if (signedIn) {
        const savedId = await withTimeout(persistCase(revealed, id), PERSIST_MS, id);
        if (savedId) setCaseId(savedId);
      }
      saveFlowResume(revealed, caseIdRef.current);
      setStatus(null);
      return revealed;
    },
    [revealBurst, signedIn],
  );

  const openResults = useCallback(() => {
    saveCaseSnapshot(flowRef.current);
    saveFlowResume(flowRef.current, caseIdRef.current);
    if (!signedIn) {
      markResultsIntent();
      openAuth("case");
      setStatus("Create a free account to open and keep your results.");
      return;
    }
    router.push("/my-case");
  }, [signedIn, openAuth, router]);

  const restartChat = useCallback(() => {
    submittingRef.current = false;
    pendingPromptRef.current = null;
    clearFlowResume();
    try {
      sessionStorage.removeItem(CASE_SNAPSHOT_KEY);
    } catch {
      /* ignore */
    }
    const fresh = createInitialFlow(true);
    flowRef.current = fresh;
    caseIdRef.current = null;
    setFlow(fresh);
    setCaseId(null);
    setStatus(null);
    setUploadNote(null);
    setTyping(false);
    setRothkoPulse((n) => n + 1);
  }, []);

  const canRestart =
    flow.messages.some((m) => m.role === "you") ||
    flow.phase !== "collect_story" ||
    Boolean(flow.actionPlan);

  const onSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (submittingRef.current) {
        pendingPromptRef.current = trimmed;
        setStatus("Got it — will take that next…");
        return;
      }
      setRothkoPulse((n) => n + 1);

      submittingRef.current = true;
      setUploadNote(null);
      setStatus(null);
      const result = advanceFlow(flowRef.current, trimmed);
      void (async () => {
        try {
          let revealed = await revealBurst(result.state, result.shamanBurst);
          let id = caseIdRef.current;

          if (result.needsExplain) {
            revealed = (await runExplain(revealed, id)) || revealed;
            id = caseIdRef.current;
          }

          if (result.planReady || revealed.actionPlan) {
            setStatus("Searching who can help…");
            const withServices = await withTimeout(
              enrichPlanServices(revealed),
              22_000,
              withPlanServices(revealed),
            );
            setFlow(withServices);
            flowRef.current = withServices;
            saveCaseSnapshot(withServices);
            saveFlowResume(withServices, id);
            if (signedIn) {
              setStatus("Saving your results…");
              id =
                (await withTimeout(persistCase(withServices, id), PERSIST_MS, id)) || id;
              if (id) setCaseId(id);
              setStatus(null);
            } else {
              setStatus("Results ready — create an account to save and open the full page.");
            }
          } else if (result.shouldPersist && signedIn) {
            setStatus("Saving…");
            id = (await withTimeout(persistCase(revealed, id), PERSIST_MS, id)) || id;
            if (id) setCaseId(id);
            setStatus(null);
          }

          saveFlowResume(flowRef.current, caseIdRef.current);
        } finally {
          submittingRef.current = false;
          const pending = pendingPromptRef.current;
          pendingPromptRef.current = null;
          if (pending) onSubmit(pending);
        }
      })();
    },
    [signedIn, runExplain, revealBurst],
  );

  const onUpload = useCallback(
    async (file: File) => {
      const safety = await validateUploadFile(file);
      if (!safety.ok) {
        setUploadNote(safety.error);
        return;
      }

      setUploadNote(`Reading “${safety.safeName}”…`);
      setStatus("Reading document…");

      const body = new FormData();
      body.append("file", file);
      let chatText = "";
      let brief: DocumentBrief | null = null;
      let storySeed = "";
      try {
        const res = await fetch(resolveApiUrl("/api/cases/analyze-document"), {
          method: "POST",
          body,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          chatText?: string;
          storySeed?: string;
          brief?: DocumentBrief;
          dataUrl?: string;
        };
        if (!res.ok) {
          setUploadNote(data.error || "Couldn’t read that file — try another photo or PDF.");
          setStatus(null);
          return;
        }
        chatText = data.chatText || "";
        brief = data.brief || null;
        storySeed = data.storySeed || "";

        if (brief && chatText) {
          const next = applyDocumentBrief(flowRef.current, {
            chatText,
            brief,
            fileName: safety.safeName,
            storySeed,
          });
          flowRef.current = next;
          setFlow(next);
          saveFlowResume(next, caseIdRef.current);
          saveCaseSnapshot(next);
          setRothkoPulse((n) => n + 1);
        }

        // Persist to case when signed in (vault + brief).
        if (signedIn) {
          let id = caseId;
          if (!id) {
            id = await withTimeout(persistCase(flowRef.current, null), PERSIST_MS, null);
            if (id) setCaseId(id);
          }
          if (id) {
            const attachBody = new FormData();
            attachBody.append("file", file);
            if (brief) {
              attachBody.append("extractedBrief", JSON.stringify(brief));
            }
            await fetch(resolveApiUrl(`/api/cases/${id}/attachments`), {
              method: "POST",
              body: attachBody,
            }).catch(() => null);
            setUploadNote(`Read and saved “${safety.safeName}” to Your case.`);
          } else {
            setUploadNote(`Read “${safety.safeName}”. Sign in to save it on Your case.`);
          }
        } else {
          setUploadNote(
            `Read “${safety.safeName}”. Sign in anytime to save uploads on Your case.`,
          );
        }
      } catch {
        setUploadNote("Upload failed — check your connection and try again.");
      } finally {
        setStatus(null);
      }
    },
    [signedIn, caseId, revealBurst],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Fixed colour fields sit at document level styles (globals.css). Keep outside
          overflow clipping so production always paints the Rothko backdrop. */}
      <RothkoField pulseKey={rothkoPulse} highlightMessages highlightInput />

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden px-3 py-3 md:px-4 md:py-4">
        <header className="relative shrink-0 px-1 pb-2 text-center">
          <p className="font-serif text-xs font-medium tracking-wide text-primary drop-shadow-sm">
            Legal Shaman
          </p>
          <h1 className="font-serif text-2xl font-bold text-foreground drop-shadow-sm md:text-3xl">
            Ask the Shaman
          </h1>
          {canRestart ? (
            <button
              type="button"
              onClick={restartChat}
              className="absolute right-0 top-1 rounded-lg border border-white/40 bg-background/40 px-2.5 py-1 text-[11px] font-medium text-foreground/80 backdrop-blur-sm hover:bg-background/70 hover:text-foreground md:top-2 md:px-3 md:text-xs"
            >
              Restart chat
            </button>
          ) : null}
        </header>

        {!loading && !signedIn ? (
          <div className="mb-2 shrink-0 rounded-2xl border border-white/30 bg-background/20 px-4 py-2 text-center text-xs text-foreground/85 backdrop-blur-[2px]">
            Chat freely — upload letters or photos without an account. Sign in to save results and Your case.{" "}
            <button
              type="button"
              onClick={() => openAuth("case")}
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              Sign in
            </button>
          </div>
        ) : null}

        {/* One blended surface: thread + composer */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-white/35 bg-background/20 shadow-[0_12px_40px_rgba(20,30,20,0.12)] backdrop-blur-[2px]">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 md:px-4 md:py-4">
            <div className="space-y-3">
              {flow.messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "you" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm md:text-base ${
                      m.role === "you"
                        ? "bg-primary/95 text-primary-foreground"
                        : "border border-white/40 bg-background/55 text-foreground backdrop-blur-sm"
                    }`}
                  >
                    <ChatText text={m.text} isYou={m.role === "you"} />
                  </div>
                </div>
              ))}
              {typing ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-white/40 bg-background/55 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
                    <span className="inline-flex gap-1">
                      <span className="animate-pulse">●</span>
                      <span className="animate-pulse [animation-delay:150ms]">●</span>
                      <span className="animate-pulse [animation-delay:300ms]">●</span>
                    </span>
                  </div>
                </div>
              ) : null}
              {flow.actionPlan ? (
                <div className="rounded-2xl border border-white/35 bg-background/70 p-2 shadow-sm backdrop-blur-sm">
                  <ActionPlanView
                    plan={{
                      ...flow.actionPlan,
                      freeServices:
                        flow.actionPlan.freeServices?.length
                          ? flow.actionPlan.freeServices
                          : freeServicesForKind(
                              flow.disputeKind || flow.answers.disputeKind || null,
                              flow.answers.disputeStory || flow.summary,
                            ),
                    }}
                    title="Your results"
                    kind={flow.disputeKind || flow.answers.disputeKind || null}
                    story={flow.answers.disputeStory || flow.summary || flow.title}
                    preferFreeOpen={false}
                    brief={{
                      title: flow.title || "Your situation",
                      summary: flow.summary || flow.answers.disputeStory || null,
                      matterType: flow.disputeKind || flow.answers.disputeKind || null,
                      fundingPreference: flow.fundingPreference,
                      profileAnswers: flow.answers,
                      actionPlan: flow.actionPlan,
                      generatedAt: new Date().toISOString(),
                    }}
                    onPlanPatch={(patch) => {
                      setFlow((prev) => {
                        if (!prev.actionPlan) return prev;
                        const next = {
                          ...prev,
                          actionPlan: { ...prev.actionPlan, ...patch },
                          answers: {
                            ...prev.answers,
                            solicitorMatchMode:
                              patch.solicitorMatchMode ?? prev.answers.solicitorMatchMode,
                            solicitorLocation:
                              patch.solicitorLocation === undefined
                                ? prev.answers.solicitorLocation
                                : patch.solicitorLocation || undefined,
                          },
                        };
                        saveFlowResume(next, caseIdRef.current);
                        return next;
                      });
                    }}
                  />
                  <div className="mt-4 flex flex-wrap justify-center gap-3 pb-2">
                    <button
                      type="button"
                      onClick={openResults}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      {signedIn ? "Open full results page" : "Sign in to open full results"}
                    </button>
                    {signedIn ? (
                      <Link
                        href="/my-case"
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background/60 px-5 text-sm font-medium text-foreground"
                      >
                        Your case
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div ref={threadEndRef} />
            </div>
          </div>

          <div className="shrink-0 bg-background/15 px-3 py-3 md:px-4 md:py-4">
            <ThirdEyeInput
              onSubmit={onSubmit}
              onUpload={(f) => onUpload(f)}
              allowUpload
              placeholder={shamanPromptForPhase(flow)}
            />
            {status ? (
              <p className="mt-2 text-center text-xs text-foreground/75">{status}</p>
            ) : null}
            {uploadNote ? (
              <p className="mt-2 text-center text-xs text-primary">{uploadNote}</p>
            ) : null}
            <p className="mt-2 text-center text-[11px] text-foreground/65">
              We signpost and map claims, financing, and solicitor costs — a tool to access justice, not a solicitor or legal advice. Chat is saved on this device until you sign in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
