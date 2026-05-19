"use client";

import type { SearchEventInput } from "@/lib/search-events/types";

const SESSION_KEY = "signpost_search_session";

export function getOrCreateSearchSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `s-${Math.random().toString(36).slice(2)}`;
  }
}

export function trackSearchEvent(
  input: Omit<SearchEventInput, "sessionId"> & { sessionId?: string },
): void {
  const sessionId = input.sessionId ?? getOrCreateSearchSessionId();
  if (!sessionId) return;

  void fetch("/api/search/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, sessionId }),
  }).catch(() => {
    /* non-blocking */
  });
}
