"use client";

import { useEffect } from "react";
import { captureProductEvent } from "@/components/analytics/posthog-provider";
import { FUNNEL_EVENTS } from "@/lib/analytics/funnel-events";

export function ProblemLandingTracker({ slug }: { slug: string }) {
  useEffect(() => {
    captureProductEvent(FUNNEL_EVENTS.problemLandingViewed, { landing: slug });
  }, [slug]);
  return null;
}
