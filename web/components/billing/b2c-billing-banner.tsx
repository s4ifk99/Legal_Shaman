"use client";

import { useEffect, useState } from "react";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { captureProductEvent } from "@/components/analytics/posthog-provider";
import {
  B2C_ANALYTICS_INTERVAL,
  B2C_FREE_SEARCH_LIMIT_DEFAULT,
  B2C_PAID_PRICE_GBP,
  B2C_PAID_PRICE_LABEL,
} from "@/lib/billing/plan";

type BillingStatus = {
  plan: "free" | "paid";
  monthlySearchUsed: number;
  monthlySearchLimit: number | null;
  currentPeriodEnd: string | null;
  price: string;
};

export function B2CBillingBanner() {
  const { user, openAuth } = useBookmarks();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/billing/status", { cache: "no-store" });
    if (!response.ok) return;
    setStatus((await response.json()) as BillingStatus);
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function startCheckout() {
    setBusy(true);
    setMessage("");
    captureProductEvent("b2c_upgrade_started", {
      price: B2C_PAID_PRICE_GBP,
      interval: B2C_ANALYTICS_INTERVAL,
    });
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST" });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !data?.url) throw new Error(data?.error || "checkout_failed");
      captureProductEvent("b2c_checkout_opened", { provider: "stripe_revenuecat" });
      window.location.assign(data.url);
    } catch {
      captureProductEvent("b2c_upgrade_failed", { reason: "checkout_failed" });
      setMessage("Checkout is temporarily unavailable. Please try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => openAuth("search")}>
        Sign in — {B2C_FREE_SEARCH_LIMIT_DEFAULT} free searches, then {B2C_PAID_PRICE_LABEL} unlimited
      </button>
    );
  }

  if (!status || status.plan === "paid") return null;

  const limit = status.monthlySearchLimit ?? B2C_FREE_SEARCH_LIMIT_DEFAULT;
  const remaining = Math.max(0, limit - status.monthlySearchUsed);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-2 text-sm">
      <span>
        Free plan:{" "}
        <strong>{remaining}</strong> of {limit} free search{limit === 1 ? "" : "es"} remaining
      </span>
      <button
        type="button"
        className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-60"
        disabled={busy}
        onClick={() => void startCheckout()}
      >
        {busy ? "Opening checkout…" : `Unlock unlimited · ${B2C_PAID_PRICE_LABEL}`}
      </button>
      {message ? <span className="basis-full text-xs text-muted-foreground">{message}</span> : null}
    </div>
  );
}
