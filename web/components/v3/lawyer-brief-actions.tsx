"use client";

import { useState } from "react";
import {
  briefFilename,
  buildLawyerBriefHtml,
  buildLawyerBriefPdf,
  type LawyerBriefInput,
} from "@/lib/cases/lawyer-brief";
import { resolveApiUrl } from "@/lib/site/api-url";

type Props = {
  brief: LawyerBriefInput;
  caseId?: string | null;
  defaultEmail?: string | null;
  requireAuth?: () => void;
  signedIn: boolean;
};

function downloadPdf(brief: LawyerBriefInput) {
  const bytes = buildLawyerBriefPdf(brief);
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = briefFilename(brief.title);
  a.click();
  URL.revokeObjectURL(url);
}

function openPrintable(brief: LawyerBriefInput) {
  const html = buildLawyerBriefHtml(brief);
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  window.setTimeout(() => {
    try {
      w.print();
    } catch {
      /* ignore */
    }
  }, 250);
}

export function LawyerBriefActions({
  brief,
  caseId,
  defaultEmail,
  requireAuth,
  signedIn,
}: Props) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendEmail() {
    if (!signedIn) {
      requireAuth?.();
      setStatus("Sign in to email your branded PDF brief.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(resolveApiUrl("/api/cases/brief-email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email.trim() || undefined,
          caseId: caseId || undefined,
          brief,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        to?: string;
        logged?: boolean;
      };
      if (!res.ok) {
        setStatus(data.error || "Couldn’t send just now.");
        return;
      }
      setStatus(
        data.logged
          ? `Brief queued for ${data.to || email} (dev mode).`
          : `Sent branded PDF brief to ${data.to || email}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function onDownload() {
    if (!signedIn) {
      requireAuth?.();
      setStatus("Sign in to download your branded PDF brief.");
      return;
    }
    downloadPdf(brief);
    setStatus("PDF downloaded — share it with your lawyer.");
  }

  function onPrint() {
    if (!signedIn) {
      requireAuth?.();
      setStatus("Sign in to print / save your branded brief.");
      return;
    }
    openPrintable(brief);
  }

  return (
    <section className="rounded-3xl border-2 border-gold/30 bg-card/95 p-5 shadow-sm md:p-6">
      <h2 className="font-serif text-xl font-semibold text-foreground md:text-2xl">
        Share with a lawyer
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Email or download a Legal Shaman–branded PDF brief so you can explain your matter clearly.
        Not legal advice — a structured summary of what you told us.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Download PDF
        </button>
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-secondary/40"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="brief-email">
          Email address
        </label>
        <input
          id="brief-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com or lawyer@firm.com"
          className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void sendEmail()}
          className="inline-flex h-10 items-center justify-center rounded-xl border-2 border-primary/40 bg-primary/5 px-4 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          {busy ? "Sending…" : "Email PDF brief"}
        </button>
      </div>
      {status ? <p className="mt-2 text-xs text-muted-foreground">{status}</p> : null}
    </section>
  );
}
