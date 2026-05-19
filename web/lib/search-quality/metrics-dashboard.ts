import "server-only";

import { prisma } from "@/lib/db/prisma";

const DEFAULT_DAYS = 14;

export type SearchQualityMetrics = {
  periodDays: number;
  directoryInteractions: number;
  noResultRate: number;
  zeroResultInteractions: number;
  mapInteractionRate: number;
  refinementEventRate: number;
  contactCtaRate: number;
  clickThroughRate: number;
  /** Share of directory interactions where a clarification chip was shown. */
  clarificationRate: number;
  fallbackEventCount: number;
};

/**
 * High-level funnel metrics for the admin dashboard (best-effort from persisted telemetry).
 */
export async function loadSearchQualityMetrics(opts?: { days?: number }): Promise<SearchQualityMetrics> {
  const days = opts?.days ?? DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86400000);

  const [interactions, clarifyCount, events] = await Promise.all([
    prisma.searchInteraction.count({
      where: { createdAt: { gte: since }, channel: "directory" },
    }),
    prisma.searchInteraction.count({
      where: { createdAt: { gte: since }, channel: "directory", clarifyingAsked: true },
    }),
    prisma.searchEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { eventType: true, page: true, metadata: true },
    }),
  ]);

  const zeroResults = await prisma.searchInteraction.count({
    where: { createdAt: { gte: since }, channel: "directory", resultCount: 0 },
  });

  const impressions = events.filter((e) => e.eventType === "result_impression").length;
  const clicks = events.filter((e) => e.eventType === "result_click" || e.eventType === "map_marker_click").length;
  const contacts = events.filter(
    (e) =>
      e.eventType === "contact_cta_click" ||
      e.eventType === "phone_click" ||
      e.eventType === "website_click",
  ).length;
  const refinements = events.filter((e) => e.eventType === "refinement_click").length;
  const noRes = events.filter((e) => e.eventType === "no_result_search").length;
  const mapClicks = events.filter((e) => e.eventType === "map_marker_click").length;

  const fallbackEventCount = events.filter((e) => {
    const m = e.metadata as Record<string, unknown> | null;
    return Boolean(m && typeof m.externalFallback === "boolean" && m.externalFallback);
  }).length;

  const imp = impressions || 1;

  return {
    periodDays: days,
    directoryInteractions: interactions,
    noResultRate: Math.round((noRes / Math.max(1, events.length)) * 1000) / 1000,
    zeroResultInteractions: zeroResults,
    mapInteractionRate: Math.round((mapClicks / imp) * 1000) / 1000,
    refinementEventRate: Math.round((refinements / Math.max(1, events.length)) * 1000) / 1000,
    contactCtaRate: Math.round((contacts / imp) * 1000) / 1000,
    clickThroughRate: Math.round((clicks / imp) * 1000) / 1000,
    clarificationRate:
      interactions > 0 ? Math.round((clarifyCount / interactions) * 1000) / 1000 : 0,
    fallbackEventCount,
  };
}
