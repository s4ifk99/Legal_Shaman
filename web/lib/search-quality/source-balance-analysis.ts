import "server-only";

import { prisma } from "@/lib/db/prisma";

const DEFAULT_DAYS = 30;

export type SourceBalanceReport = {
  periodDays: number;
  impressionsBySource: Record<string, number>;
  clicksBySource: Record<string, number>;
  contactBySource: Record<string, number>;
  ctrBySource: Record<string, number>;
  contactRateBySource: Record<string, number>;
  /** From SearchRankingSignal aggregates */
  signalRows: {
    entitySource: string;
    impressions: number;
    clicks: number;
    contactClicks: number;
    ctr: number;
    contactRate: number;
  }[];
  dominantSources: string[];
  underEngagedSources: string[];
};

export async function analyzeSourceBalance(opts?: { days?: number }): Promise<SourceBalanceReport> {
  const days = opts?.days ?? DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86400000);

  const events = await prisma.searchEvent.findMany({
    where: {
      createdAt: { gte: since },
      resultSource: { not: null },
    },
    select: { eventType: true, resultSource: true },
  });

  const impressionsBySource: Record<string, number> = {};
  const clicksBySource: Record<string, number> = {};
  const contactBySource: Record<string, number> = {};

  for (const e of events) {
    const src = e.resultSource ?? "unknown";
    if (e.eventType === "result_impression") {
      impressionsBySource[src] = (impressionsBySource[src] ?? 0) + 1;
    } else if (e.eventType === "result_click" || e.eventType === "map_marker_click") {
      clicksBySource[src] = (clicksBySource[src] ?? 0) + 1;
    } else if (
      e.eventType === "contact_cta_click" ||
      e.eventType === "phone_click" ||
      e.eventType === "website_click"
    ) {
      contactBySource[src] = (contactBySource[src] ?? 0) + 1;
    }
  }

  const ctrBySource: Record<string, number> = {};
  const contactRateBySource: Record<string, number> = {};
  const sources = new Set([
    ...Object.keys(impressionsBySource),
    ...Object.keys(clicksBySource),
    ...Object.keys(contactBySource),
  ]);
  for (const s of sources) {
    const imp = impressionsBySource[s] ?? 0;
    const clk = clicksBySource[s] ?? 0;
    const con = contactBySource[s] ?? 0;
    ctrBySource[s] = imp > 0 ? Math.round((clk / imp) * 1000) / 1000 : 0;
    contactRateBySource[s] = imp > 0 ? Math.round((con / imp) * 1000) / 1000 : 0;
  }

  const signals = await prisma.searchRankingSignal.findMany({
    orderBy: { impressions: "desc" },
    take: 40,
  });

  const signalRows = signals.map((r) => ({
    entitySource: r.entitySource,
    impressions: r.impressions,
    clicks: r.clicks,
    contactClicks: r.contactClicks,
    ctr: r.ctr,
    contactRate: r.contactRate,
  }));

  const totalImp = Object.values(impressionsBySource).reduce((a, b) => a + b, 0) || 1;
  const dominantSources = Object.entries(impressionsBySource)
    .filter(([, n]) => n / totalImp > 0.35)
    .map(([s]) => s);

  const underEngagedSources = Object.keys(impressionsBySource).filter((s) => (ctrBySource[s] ?? 0) < 0.02);

  return {
    periodDays: days,
    impressionsBySource,
    clicksBySource,
    contactBySource,
    ctrBySource,
    contactRateBySource,
    signalRows,
    dominantSources,
    underEngagedSources,
  };
}
