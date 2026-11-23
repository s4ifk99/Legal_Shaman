"use client";

import { useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { DraftDecision } from "@/lib/blog-drafts/local-queue";

type FreeHelpCard = {
  title: string;
  type: string;
  url?: string;
  score: number;
  blurb: string;
};

type DraftCard = {
  file: string;
  title: string;
  demandRef: string;
  matter: string;
  why: string;
  status: DraftDecision;
  html: string;
  matchQa: "ok" | "weak" | "empty" | null;
  matchOk: boolean | null;
  matchDetail: string | null;
  freeHelp: FreeHelpCard[];
};

export function BlogReviewClient({
  date,
  initialDrafts,
}: {
  date: string;
  initialDrafts: DraftCard[];
}) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [activeFile, setActiveFile] = useState(
    () =>
      initialDrafts.find((d) => d.status === "Ready for review")?.file ??
      initialDrafts[0]?.file ??
      "",
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const rank = (s: DraftDecision) =>
      s === "Ready for review" ? 0 : s === "Approved" ? 1 : s === "Published" ? 2 : 3;
    return [...drafts].sort((a, b) => rank(a.status) - rank(b.status));
  }, [drafts]);

  const active = useMemo(
    () => drafts.find((d) => d.file === activeFile) ?? drafts[0],
    [activeFile, drafts],
  );

  const decide = (status: DraftDecision) => {
    if (!active) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/dev/blog-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, file: active.file, status }),
      });
      const data = (await res.json()) as {
        error?: string;
        draft?: { file: string; status: DraftDecision };
      };
      if (!res.ok) {
        setError(data.error || "Save failed");
        return;
      }
      setDrafts((prev) =>
        prev.map((d) => (d.file === active.file ? { ...d, status } : d)),
      );
    });
  };

  if (!active) {
    return <p className="text-muted-foreground">No drafts in this batch.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Batch {date}
        </p>
        <ul className="space-y-2">
          {ordered.map((draft) => (
            <li key={draft.file}>
              <button
                type="button"
                onClick={() => setActiveFile(draft.file)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-sm transition",
                  draft.file === active.file
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <span className="block font-medium leading-snug">{draft.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{draft.matter}</span>
                  <StatusPill status={draft.status} />
                  <MatchPill qa={draft.matchQa} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-xs text-muted-foreground">
          Decisions write to <code>data/blog-drafts/{date}/decisions.json</code>
        </p>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-card p-4">
          <div className="min-w-0 space-y-1">
            <h1 className="font-serif text-2xl font-semibold leading-tight">{active.title}</h1>
            <p className="text-sm text-muted-foreground">{active.why}</p>
            <p className="text-xs text-muted-foreground">
              Demand ref <code>{active.demandRef}</code> · {active.file}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <MatchPill qa={active.matchQa} />
              {active.matchDetail ? (
                <span className="text-xs text-muted-foreground">{active.matchDetail}</span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || active.status === "Published"}
              onClick={() => decide("Approved")}
              className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pending || active.status === "Published"}
              onClick={() => decide("Kill")}
              className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              Kill
            </button>
            <button
              type="button"
              disabled={pending || active.status === "Published"}
              onClick={() => decide("Ready for review")}
              className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="rounded-md border border-dashed border-border bg-muted/30 p-4">
          <h2 className="text-sm font-semibold">Matched free doors (product test)</h2>
          {active.freeHelp.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No snapshot yet. Run{" "}
              <code>npm run blog:match-free -- --date {date} --seed</code>.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {active.freeHelp.map((h) => (
                <li key={`${h.title}-${h.score}`} className="text-sm">
                  <span className="font-medium">{h.title}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {h.type || "free"} · score {h.score.toFixed(1)}
                  </span>
                  {h.url ? (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 text-xs text-primary underline"
                    >
                      open
                    </a>
                  ) : null}
                  {h.blurb ? (
                    <p className="text-xs text-muted-foreground">{h.blurb.slice(0, 140)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <article
          className="rounded-md border bg-card p-5 md:p-6"
          dangerouslySetInnerHTML={{ __html: active.html }}
        />
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: DraftDecision }) {
  const tone =
    status === "Approved"
      ? "bg-emerald-100 text-emerald-900"
      : status === "Published"
        ? "bg-sky-100 text-sky-900"
        : status === "Kill"
          ? "bg-red-100 text-red-900"
          : "bg-amber-100 text-amber-900";
  return <span className={cn("rounded px-1.5 py-0.5", tone)}>{status}</span>;
}

function MatchPill({ qa }: { qa: "ok" | "weak" | "empty" | null }) {
  if (!qa) {
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        Match pending
      </span>
    );
  }
  const tone =
    qa === "ok"
      ? "bg-emerald-100 text-emerald-900"
      : qa === "weak"
        ? "bg-amber-100 text-amber-900"
        : "bg-red-100 text-red-900";
  const label = qa === "ok" ? "Match OK" : qa === "weak" ? "Match weak" : "Match empty";
  return <span className={cn("rounded px-1.5 py-0.5 text-xs", tone)}>{label}</span>;
}
