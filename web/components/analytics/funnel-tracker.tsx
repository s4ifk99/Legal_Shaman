"use client";

import { useEffect, useRef } from "react";
import { captureProductEvent } from "@/components/analytics/posthog-provider";
import { FUNNEL_EVENTS } from "@/lib/analytics/funnel-events";

type SearchFunnelTrackerProps = {
  query: string;
  resultCount: number;
  landing?: string;
};

/** Fires search_started + search_completed once per query key when results load. */
export function SearchFunnelTracker({ query, resultCount, landing }: SearchFunnelTrackerProps) {
  const seen = useRef<string | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    const key = `${q}|${resultCount}|${landing ?? ""}`;
    if (seen.current === key) return;
    seen.current = key;
    const props = {
      query_len: q.length,
      result_count: resultCount,
      landing: landing ?? null,
    };
    captureProductEvent(FUNNEL_EVENTS.searchStarted, props);
    captureProductEvent(FUNNEL_EVENTS.searchCompleted, props);
  }, [q, resultCount, landing]);

  return null;
}

type ResultViewTrackerProps = {
  entityId: string;
  resultSource: string;
  expanded: boolean;
};

export function ResultViewTracker({ entityId, resultSource, expanded }: ResultViewTrackerProps) {
  const fired = useRef<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const key = `${resultSource}:${entityId}`;
    if (fired.current === key) return;
    fired.current = key;
    captureProductEvent(FUNNEL_EVENTS.resultViewed, {
      entity_id: entityId,
      result_source: resultSource,
    });
  }, [expanded, entityId, resultSource]);

  return null;
}
