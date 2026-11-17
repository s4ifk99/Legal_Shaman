"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { ActionPlanView } from "@/components/v3/action-plan-view";
import { LawyerBriefActions } from "@/components/v3/lawyer-brief-actions";
import { freeServicesForKind } from "@/lib/cases/free-services";
import { CASE_SNAPSHOT_KEY } from "@/lib/cases/flow-resume";
import type { ActionPlan, CaseRecord } from "@/lib/cases/types";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import { resolveApiUrl } from "@/lib/site/api-url";

type MineResponse = {
  case: CaseRecord | null;
  bookmarks?: Array<{
    id: string;
    businessName: string;
    note: string | null;
    status: string;
  }>;
};

type LocalSnapshot = {
  title?: string;
  summary?: string | null;
  matterType?: string | null;
  fundingPreference?: CaseRecord["fundingPreference"];
  actionPlan?: ActionPlan | null;
  profileAnswers?: CaseRecord["profileAnswers"];
  updatedAt?: string;
};

function fundingLabel(caseRow: Pick<CaseRecord, "fundingPreference">): string {
  switch (caseRow.fundingPreference) {
    case "legal_aid":
      return "Legal aid first";
    case "pro_bono":
      return "Free advice first";
    case "insurance":
      return "Insurance / union cover";
    case "fixed_fee":
      return "Open to fixed fee";
    case "private":
      return "Open to private help";
    default:
      return "Still exploring financing";
  }
}

function readSnapshot(): LocalSnapshot | null {
  try {
    const raw = sessionStorage.getItem(CASE_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalSnapshot;
  } catch {
    return null;
  }
}

function mergeFreeServices(
  plan: ActionPlan | null | undefined,
  kind: DisputeKind | null,
  story?: string | null,
): ActionPlan | null {
  if (!plan) return null;
  if (plan.freeServices && plan.freeServices.length > 0) return plan;
  return { ...plan, freeServices: freeServicesForKind(kind, story) };
}

function snapshotAsRow(snap: LocalSnapshot, userId: string): CaseRecord {
  return {
    id: "local-snapshot",
    userId,
    title: snap.title || "Your situation",
    summary: snap.summary || null,
    matterType: snap.matterType || null,
    jurisdiction: null,
    locationHint: null,
    status: "exploring",
    fundingKnowledge: null,
    fundingPreference: snap.fundingPreference || null,
    fundingNotes: null,
    profileAnswers: snap.profileAnswers || null,
    actionPlan: snap.actionPlan || null,
    attachments: null,
    sessionSnapshot: null,
    createdAt: snap.updatedAt || new Date().toISOString(),
    updatedAt: snap.updatedAt || new Date().toISOString(),
  };
}

export function MyCaseClient() {
  const { user, loading, openAuth } = useBookmarks();
  const [row, setRow] = useState<CaseRecord | null>(null);
  const [bookmarks, setBookmarks] = useState<MineResponse["bookmarks"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingTitle, setSavingTitle] = useState(false);
  const [fromSnapshot, setFromSnapshot] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setRow(null);
      return;
    }
    setError(null);
    const snap = readSnapshot();
    const res = await fetch(resolveApiUrl("/api/cases/mine"));
    if (res.status === 401) {
      setRow(null);
      return;
    }
    if (!res.ok) {
      if (snap?.actionPlan) {
        setFromSnapshot(true);
        setRow(snapshotAsRow(snap, user.id));
        return;
      }
      setError("We couldn’t load your case just now. Please try again.");
      return;
    }
    const data = (await res.json()) as MineResponse;
    if (data.case) {
      setFromSnapshot(false);
      setRow(data.case);
      setBookmarks(data.bookmarks || []);
      return;
    }
    if (snap?.actionPlan) {
      setFromSnapshot(true);
      setRow(snapshotAsRow(snap, user.id));
      return;
    }
    setRow(null);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTitle(title: string) {
    if (!row || !title.trim() || row.id === "local-snapshot") return;
    setSavingTitle(true);
    try {
      const res = await fetch(resolveApiUrl(`/api/cases/${row.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as { case: CaseRecord };
        setRow(data.case);
      }
    } finally {
      setSavingTitle(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading your results…</p>;
  }

  if (!user) {
    return (
      <div className="rounded-3xl border-2 border-gold/30 bg-card/90 p-8 text-center shadow-sm">
        <h1 className="font-serif text-3xl font-semibold text-foreground">Your results</h1>
        <p className="mt-3 text-muted-foreground">
          Create a free account to open your plan, free services, and a branded PDF brief for your
          lawyer. Your chat on this device is kept until you sign in.
        </p>
        <button
          type="button"
          onClick={() => openAuth("case")}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Create account or sign in
        </button>
        <div className="mt-4">
          <Link href="/" className="text-sm text-primary underline-offset-2 hover:underline">
            Back to the conversation
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>;
  }

  if (!row) {
    return (
      <div className="rounded-3xl border-2 border-gold/30 bg-card/90 p-8 text-center shadow-sm">
        <h1 className="font-serif text-3xl font-semibold text-foreground">Your results</h1>
        <p className="mt-3 text-muted-foreground">
          No plan saved yet. Finish the conversation and we’ll show your options, money path, and
          free services here.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Continue the conversation
        </Link>
      </div>
    );
  }

  const kind = (row.matterType || row.profileAnswers?.disputeKind || null) as DisputeKind | null;
  const story = row.summary || row.profileAnswers?.disputeStory || null;
  const plan = mergeFreeServices(row.actionPlan, kind, story);

  return (
    <div className="space-y-8 pb-10">
      <header className="rounded-3xl border border-gold/25 bg-card/90 px-5 py-6 shadow-sm md:px-7">
        <p className="text-sm font-medium text-primary">Your results</p>
        <input
          defaultValue={row.title}
          onBlur={(e) => void saveTitle(e.target.value)}
          disabled={savingTitle || row.id === "local-snapshot"}
          className="mt-2 w-full border-0 border-b-2 border-transparent bg-transparent font-serif text-3xl font-semibold text-foreground outline-none focus:border-primary/40 md:text-4xl"
          aria-label="Case title"
        />
        {row.summary ? (
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">{row.summary}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            {fundingLabel(row)}
          </span>
          {kind ? (
            <span className="inline-flex rounded-full bg-secondary/40 px-3 py-1 text-xs font-medium text-foreground">
              {kind}
            </span>
          ) : null}
          {fromSnapshot ? (
            <span className="inline-flex rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-900">
              Showing latest chat results
            </span>
          ) : null}
        </div>
      </header>

      {plan ? (
        <ActionPlanView plan={plan} title="Plan of action" />
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Your plan is still forming.{" "}
          <Link href="/" className="text-primary underline">
            Continue the conversation
          </Link>
        </div>
      )}

      {plan ? (
        <LawyerBriefActions
          signedIn
          caseId={row.id}
          defaultEmail={user.email}
          brief={{
            title: row.title,
            summary: row.summary,
            matterType: row.matterType,
            fundingPreference: row.fundingPreference,
            profileAnswers: row.profileAnswers,
            actionPlan: plan,
            clientName: user.name || user.email,
            generatedAt: new Date().toISOString(),
          }}
        />
      ) : null}

      {row.attachments && row.attachments.length > 0 ? (
        <section className="rounded-3xl border border-gold/20 bg-card/80 p-5">
          <h2 className="font-serif text-xl font-semibold text-foreground">Your uploads</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Photos, PDFs, and text letters only — scanned for unsafe file types.
          </p>
          <ul className="mt-4 space-y-2">
            {row.attachments.map((a) => (
              <li key={a.id} className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm">
                <p className="font-medium text-foreground">{a.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(a.size / 1024).toFixed(0)} KB · {new Date(a.uploadedAt).toLocaleString("en-GB")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {bookmarks && bookmarks.length > 0 ? (
        <section className="rounded-3xl border border-gold/20 bg-card/80 p-5">
          <h2 className="font-serif text-xl font-semibold text-foreground">Your shortlist</h2>
          <ul className="mt-4 space-y-3">
            {bookmarks.map((b) => (
              <li key={b.id} className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm">
                <p className="font-medium text-foreground">{b.businessName}</p>
                {b.note ? <p className="mt-1 text-muted-foreground">{b.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Continue the conversation
        </Link>
        <Link
          href="/search"
          className="inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground"
        >
          Directory search
        </Link>
      </div>
    </div>
  );
}
