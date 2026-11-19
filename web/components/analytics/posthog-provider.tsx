"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import {
  JOURNEY_EVENTS,
  JOURNEY_STORAGE,
} from "@/lib/analytics/journey-events";
import { FUNNEL_STORAGE, readUtmFromSearch } from "@/lib/analytics/funnel-events";

let posthogReady = false;

export function captureProductEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
) {
  if (!posthogReady) return;
  const cleaned: Record<string, string | number | boolean | null> = {};
  if (properties) {
    for (const [k, v] of Object.entries(properties)) {
      if (v !== undefined) cleaned[k] = v;
    }
  }
  posthog.capture(event, cleaned);
}

function markVisit() {
  if (typeof window === "undefined") return;
  try {
    const now = new Date().toISOString();
    const first = localStorage.getItem(JOURNEY_STORAGE.firstVisitAt);
    const last = localStorage.getItem(JOURNEY_STORAGE.lastVisitAt);
    const utm = readUtmFromSearch(window.location.search);
    if (Object.keys(utm).length) {
      sessionStorage.setItem(FUNNEL_STORAGE.utm, JSON.stringify(utm));
    }
    if (!first) {
      localStorage.setItem(JOURNEY_STORAGE.firstVisitAt, now);
      captureProductEvent(JOURNEY_EVENTS.visit, {
        path: window.location.pathname,
        ...utm,
      });
    } else if (last) {
      const hours = (Date.now() - Date.parse(last)) / 3_600_000;
      if (hours >= 12) {
        captureProductEvent(JOURNEY_EVENTS.returnVisit, {
          path: window.location.pathname,
          hours_since_last: Math.round(hours),
          ...utm,
        });
      }
    }
    localStorage.setItem(JOURNEY_STORAGE.lastVisitAt, now);
  } catch {
    /* private mode / quota */
  }
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const { user } = useBookmarks();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
    if (!key || posthogReady) return;

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
      // App Router SPA navigations — cover every page without per-route wiring.
      capture_pageview: "history_change",
      capture_pageleave: true,
      // Explicit journey events only (see journey-events.ts / funnel-events.ts).
      autocapture: false,
      persistence: "localStorage+cookie",
      person_profiles: "identified_only",
    });
    posthogReady = true;
    markVisit();
  }, []);

  useEffect(() => {
    if (!posthogReady) return;
    if (user) {
      posthog.identify(user.id, { plan: user.plan || "free" });
    } else {
      posthog.reset();
    }
  }, [user]);

  return children;
}

/**
 * Extra App Router pageview + path props for every route change.
 * Works with Suspense boundaries when search params are used.
 */
export function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthogReady || !pathname) return;
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture("$pageview", {
      $current_url: typeof window !== "undefined" ? window.location.href : url,
      path: pathname,
      search: search || "",
    });
  }, [pathname, searchParams]);

  return null;
}
