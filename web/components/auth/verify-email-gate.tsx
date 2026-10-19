"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, MailWarning } from "lucide-react";
import type { PublicUser } from "@/lib/auth/user-session";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveApiUrl } from "@/lib/site/api-url";

type Props = {
  user: PublicUser | null;
  promptOpen: boolean;
  onPromptOpenChange: (open: boolean) => void;
  refreshSession: () => Promise<PublicUser | null>;
  onUseDifferentEmail: () => void | Promise<void>;
};

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "checking" }
  | { kind: "still_unverified" }
  | { kind: "link_expired" }
  | { kind: "link_invalid" }
  | { kind: "error"; message: string };

function statusMessage(status: Status, email: string): string | null {
  switch (status.kind) {
    case "sending":
      return "Sending a new link…";
    case "sent":
      return `New link sent to ${email}. It can take a minute to arrive — check spam or junk too.`;
    case "checking":
      return "Checking…";
    case "still_unverified":
      return "We haven't seen the confirmation yet. Click the link in the email, then come back here.";
    case "link_expired":
      return "That confirmation link has expired. Send a new one below.";
    case "link_invalid":
      return "That confirmation link didn't work. Send a new one below.";
    case "error":
      return status.message;
    default:
      return null;
  }
}

/**
 * Site-wide "confirm your email" gate: a banner above every page while the
 * signed-in user is unverified, plus a blocking dialog when an action fails
 * because of it. Analysis and search APIs reject unverified accounts.
 */
export function VerifyEmailGate({
  user,
  promptOpen,
  onPromptOpenChange,
  refreshSession,
  onUseDifferentEmail,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [justVerified, setJustVerified] = useState(false);
  const checkingRef = useRef(false);

  const unverified = Boolean(user && user.emailVerified === false);
  const email = user?.email || "your email address";

  // Handle the redirect back from /api/auth/verify-email (?verified=1 or ?verify=<error>).
  useEffect(() => {
    const url = new URL(window.location.href);
    const verified = url.searchParams.get("verified");
    const verifyError = url.searchParams.get("verify");
    if (!verified && !verifyError) return;
    url.searchParams.delete("verified");
    url.searchParams.delete("verify");
    window.history.replaceState({}, "", url.toString());
    if (verified === "1") {
      setJustVerified(true);
      void refreshSession();
    } else if (verifyError === "expired_token") {
      setStatus({ kind: "link_expired" });
    } else {
      setStatus({ kind: "link_invalid" });
    }
  }, [refreshSession]);

  const checkNow = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      if (!opts.quiet) setStatus({ kind: "checking" });
      try {
        const next = await refreshSession();
        if (next && next.emailVerified !== false) {
          setJustVerified(true);
          setStatus({ kind: "idle" });
          onPromptOpenChange(false);
        } else if (!opts.quiet) {
          setStatus({ kind: "still_unverified" });
        }
      } finally {
        checkingRef.current = false;
      }
    },
    [refreshSession, onPromptOpenChange],
  );

  // Users usually confirm in another tab — re-check when they come back.
  useEffect(() => {
    if (!unverified) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkNow({ quiet: true });
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [unverified, checkNow]);

  useEffect(() => {
    if (!unverified && promptOpen) onPromptOpenChange(false);
  }, [unverified, promptOpen, onPromptOpenChange]);

  async function resend() {
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(resolveApiUrl("/api/auth/resend-verification"), { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        alreadyVerified?: boolean;
      };
      if (res.status === 429) {
        setStatus({ kind: "error", message: "Too many attempts. Wait a few minutes, then try again." });
        return;
      }
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: "We couldn't send the email just now. Try again in a moment.",
        });
        return;
      }
      if (data.alreadyVerified) {
        await checkNow();
        return;
      }
      setStatus({ kind: "sent" });
    } catch {
      setStatus({ kind: "error", message: "We couldn't send the email just now. Try again in a moment." });
    }
  }

  const message = statusMessage(status, email);
  const busy = status.kind === "sending" || status.kind === "checking";

  const actions = (
    <>
      <Button type="button" onClick={() => void resend()} disabled={busy}>
        Resend email
      </Button>
      <Button type="button" variant="outline" onClick={() => void checkNow()} disabled={busy}>
        I&apos;ve confirmed it
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="underline underline-offset-4"
        onClick={() => void onUseDifferentEmail()}
        disabled={busy}
      >
        Use a different email
      </Button>
    </>
  );

  if (!unverified) {
    if (!justVerified || !user) return null;
    return (
      <div
        role="status"
        className="border-b-2 border-emerald-600 bg-emerald-50 text-emerald-950"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 text-sm">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          <p className="flex-1 font-medium">Email confirmed — you can now get your results.</p>
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => setJustVerified(false)}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        role="alert"
        className="sticky top-0 z-50 border-b-4 border-amber-500 bg-amber-100 text-amber-950 shadow-md"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start">
          <MailWarning className="size-7 shrink-0 text-amber-700" aria-hidden />
          <div className="flex-1 space-y-1">
            <p className="text-base font-bold leading-snug">
              Confirm your email to get your results
            </p>
            <p className="text-sm leading-relaxed">
              We sent a confirmation link to <strong>{email}</strong>. Ask the Shaman and search
              won&apos;t work until you click it. Can&apos;t find it? Check your spam or junk
              folder — work and charity email filters often hold it back.
            </p>
            {message ? (
              <p className="text-sm font-semibold" aria-live="polite">
                {message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">{actions}</div>
        </div>
      </div>

      <Dialog open={promptOpen} onOpenChange={onPromptOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>One step left: confirm your email</DialogTitle>
            <DialogDescription>
              We can&apos;t show your results until you confirm <strong>{email}</strong>. Open the
              email from Legal Shaman and click the link — then come back to this tab and
              we&apos;ll carry on. Check spam or junk if it isn&apos;t in your inbox.
            </DialogDescription>
          </DialogHeader>
          {message ? (
            <p className="text-sm font-semibold" aria-live="polite">
              {message}
            </p>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">{actions}</DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
