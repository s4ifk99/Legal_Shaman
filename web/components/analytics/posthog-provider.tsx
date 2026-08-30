"use client";

import { useEffect, type ReactNode } from "react";
import posthog from "posthog-js";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";

let posthogReady = false;

export function captureProductEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
) {
  if (!posthogReady) return;
  posthog.capture(event, properties);
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const { user } = useBookmarks();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
    if (!key || posthogReady) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      capture_pageview: true,
      autocapture: false,
      disable_session_recording: true,
    });
    posthogReady = true;
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
