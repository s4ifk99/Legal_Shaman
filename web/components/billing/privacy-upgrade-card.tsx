"use client";

import { useState } from "react";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { captureProductEvent } from "@/components/analytics/posthog-provider";
import { FUNNEL_EVENTS } from "@/lib/analytics/funnel-events";
import {
  B2C_PRIVACY_PRICE_LABEL,
  PRIVACY_UPGRADE_COPY,
} from "@/lib/billing/plan";
import { Button } from "@/components/ui/button";

/** Free search + optional 99p privacy upgrade (Exp 6). Weekly £3.49 remains separate. */
export function PrivacyUpgradeCard() {
  const { user, openAuth } = useBookmarks();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function startPrivacy() {
    captureProductEvent(FUNNEL_EVENTS.privacyInterest, { price: 0.99 });
    if (!user) {
      openAuth("search");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing/privacy-checkout", { method: "POST" });
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        interestRecorded?: boolean;
        message?: string;
        error?: string;
      } | null;
      if (!response.ok) throw new Error(data?.error || "failed");
      if (data?.url) {
        captureProductEvent(FUNNEL_EVENTS.privacyCheckout, { provider: "stripe" });
        window.location.assign(data.url);
        return;
      }
      setMessage(data?.message || "Interest recorded for the 99p privacy pilot.");
    } catch {
      setMessage("Privacy checkout is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm">
      <h3 className="font-serif text-base font-semibold text-foreground">{PRIVACY_UPGRADE_COPY.title}</h3>
      <p className="mt-2 text-muted-foreground">{PRIVACY_UPGRADE_COPY.body}</p>
      <p className="mt-2 text-xs text-muted-foreground">{PRIVACY_UPGRADE_COPY.covered}</p>
      <p className="mt-2 text-xs text-muted-foreground">{PRIVACY_UPGRADE_COPY.disclaimer}</p>
      <Button
        type="button"
        className="mt-4"
        size="sm"
        disabled={busy}
        onClick={() => void startPrivacy()}
      >
        {busy ? "Working…" : `I'm interested · ${B2C_PRIVACY_PRICE_LABEL}`}
      </Button>
      {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
