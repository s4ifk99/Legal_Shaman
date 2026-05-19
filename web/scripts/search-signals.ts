/**
 * Aggregate recent SearchEvent rows into SearchRankingSignal records.
 * Run: cd web && npm run search:signals
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";

const LOOKBACK_DAYS = Number(process.env.SEARCH_SIGNALS_LOOKBACK_DAYS ?? 30);
const MIN_IMPRESSIONS = Number(process.env.SEARCH_SIGNALS_MIN_IMPRESSIONS ?? 3);

type AggRow = {
  entityId: string;
  entitySource: string;
  practiceArea: string;
  city: string;
  impressions: number;
  clicks: number;
  contactClicks: number;
};

const IMPRESSION_TYPES = new Set(["result_impression"]);
const CLICK_TYPES = new Set(["result_click", "map_marker_click"]);
const CONTACT_TYPES = new Set([
  "contact_cta_click",
  "phone_click",
  "website_click",
]);

function confidenceFromCounts(impressions: number, clicks: number, contactClicks: number): number {
  const imp = Math.max(1, impressions);
  const engagement = clicks + contactClicks * 2;
  const raw = Math.min(1, engagement / imp);
  const volumeFactor = Math.min(1, impressions / 20);
  return Math.round(raw * volumeFactor * 1000) / 1000;
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const events = await prisma.searchEvent.findMany({
    where: {
      createdAt: { gte: since },
      resultId: { not: null },
      resultSource: { not: null },
    },
    select: {
      resultId: true,
      resultSource: true,
      parsedPracticeArea: true,
      parsedLocation: true,
      eventType: true,
    },
  });

  const agg = new Map<string, AggRow>();

  for (const e of events) {
    if (!e.resultId || !e.resultSource) continue;
    const practiceArea = e.parsedPracticeArea?.trim() || "";
    const city = e.parsedLocation?.trim() || "";
    const key = `${e.resultSource}|${e.resultId}|${practiceArea}|${city}`;
    let row = agg.get(key);
    if (!row) {
      row = {
        entityId: e.resultId,
        entitySource: e.resultSource,
        practiceArea,
        city,
        impressions: 0,
        clicks: 0,
        contactClicks: 0,
      };
      agg.set(key, row);
    }
    if (IMPRESSION_TYPES.has(e.eventType)) row.impressions += 1;
    else if (CLICK_TYPES.has(e.eventType)) row.clicks += 1;
    else if (CONTACT_TYPES.has(e.eventType)) row.contactClicks += 1;
  }

  let upserted = 0;
  for (const row of agg.values()) {
    if (row.impressions < MIN_IMPRESSIONS) continue;
    const ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;
    const contactRate =
      row.impressions > 0 ? row.contactClicks / row.impressions : 0;
    const confidence = confidenceFromCounts(
      row.impressions,
      row.clicks,
      row.contactClicks,
    );

    await prisma.searchRankingSignal.upsert({
      where: {
        entityId_entitySource_practiceArea_city: {
          entityId: row.entityId,
          entitySource: row.entitySource,
          practiceArea: row.practiceArea ?? "",
          city: row.city ?? "",
        },
      },
      create: {
        entityId: row.entityId,
        entitySource: row.entitySource,
        practiceArea: row.practiceArea ?? "",
        city: row.city ?? "",
        impressions: row.impressions,
        clicks: row.clicks,
        contactClicks: row.contactClicks,
        ctr,
        contactRate,
        confidence,
      },
      update: {
        impressions: row.impressions,
        clicks: row.clicks,
        contactClicks: row.contactClicks,
        ctr,
        contactRate,
        confidence,
      },
    });
    upserted += 1;
  }

  console.log(
    `search:signals OK — processed ${events.length} events, upserted ${upserted} signals (lookback ${LOOKBACK_DAYS}d)`,
  );
}

main()
  .catch((err) => {
    console.error("search:signals failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
