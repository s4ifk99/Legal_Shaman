"use client";

import { useEffect, useRef, type ReactNode } from "react";
import posthog from "posthog-js";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import {
  FUNNEL_EVENTS,
  FUNNEL_STORAGE,
  readUtmFromSearch,
  type UtmProps,
} from "@/lib/analytics/funnel-events";

let posthogReady = false;

export function captureProductEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
) {
  if (!posthogReady) return;
  posthog.capture(event, properties);
}

function projectKey(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!key || key.length < 20) return null;
  return key;
}

function persistAndRegisterUtm(): UtmProps {
  if (typeof window === "undefined") return {};
  const fromUrl = readUtmFromSearch(window.location.search);
  let stored: UtmProps = {};
  try {
    const raw = window.localStorage.getItem(FUNNEL_STORAGE.utm);
    if (raw) stored = JSON.parse(raw) as UtmProps;
  } catch {
    stored = {};
  }
  const merged = { ...stored, ...fromUrl };
  if (Object.keys(fromUrl).length > 0) {
    try {
      window.localStorage.setItem(FUNNEL_STORAGE.utm, JSON.stringify(merged));
    } catch {
      /* ignore quota */
    }
  }
  if (Object.keys(merged).length > 0 && posthogReady) {
    posthog.register(merged);
  }
  return merged;
}

function trackVisitLifecycle() {
  if (typeof window === "undefined" || !posthogReady) return;
  const now = Date.now();
  let firstAt = 0;
  let lastAt = 0;
  try {
    firstAt = Number(window.localStorage.getItem(FUNNEL_STORAGE.firstVisitAt) || "0");
    lastAt = Number(window.localStorage.getItem(FUNNEL_STORAGE.lastVisitAt) || "0");
  } catch {
    /* ignore */
  }

  const utm = persistAndRegisterUtm();
  const dayMs = 24 * 60 * 60 * 1000;

  if (!firstAt) {
    try {
      window.localStorage.setItem(FUNNEL_STORAGE.firstVisitAt, String(now));
      window.localStorage.setItem(FUNNEL_STORAGE.lastVisitAt, String(now));
    } catch {
      /* ignore */
    }
    captureProductEvent(FUNNEL_EVENTS.visit, {
      landing: document.body?.dataset?.landing ?? null,
      ...utm,
    });
    return;
  }

  if (!lastAt || now - lastAt > dayMs) {
    captureProductEvent(FUNNEL_EVENTS.returnVisit, {
      days_since_last: lastAt ? Math.round((now - lastAt) / dayMs) : null,
      ...utm,
    });
  }

  try {
    window.localStorage.setItem(FUNNEL_STORAGE.lastVisitAt, String(now));
  } catch {
    /* ignore */
  }
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const { user } = useBookmarks();
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    const key = projectKey();
    if (!key || posthogReady) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      capture_pageview: true,
      autocapture: false,
    });
    posthogReady = true;
    trackVisitLifecycle();
  }, []);

  useEffect(() => {
    if (!posthogReady) return;
    persistAndRegisterUtm();
  }, []);

  useEffect(() => {
    if (!posthogReady) return;
    if (user) {
      posthog.identify(user.id, { plan: user.plan || "free" });
      identifiedUserId.current = user.id;
      return;
    }
    if (identifiedUserId.current) {
      posthog.reset();
      identifiedUserId.current = null;
    }
  }, [user]);

  return children;
}
