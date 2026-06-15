import { prisma } from "@/lib/db/prisma";
import { planWeakProviders } from "@/lib/provider-enrichment-ladder/enrichment-planner";
import { loadEnrichmentMap, loadSraIndexDocuments, parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";
import { completeCrawlRun, createCrawlRun } from "@/lib/provider-intelligence-crawler-v2/crawl-run";
import {
  runPracticeAreaExtractionEngine,
} from "@/lib/provider-intelligence-crawler-v2/practice-area-extraction";
import type {
  PracticeAreaBatchResult,
  PracticeAreaDebugRow,
  PracticeAreaExtractionResult,
} from "@/lib/provider-intelligence-crawler-v2/types";
import {
  resolveWebsiteForPracticeExtraction,
  type V2WebsiteRow,
} from "@/lib/provider-intelligence-crawler-v2/website-resolution";
import { markRunForRetry } from "@/lib/provider-intelligence-crawler-v2/retry-queue";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

export type PracticeAreaBatchOptions = {
  limit?: number;
  allowPendingWebsites?: boolean;
  pendingWebsiteMinConfidence?: number;
  debug?: boolean;
};

function parseCliFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseCliNumber(argv: string[], prefix: string, fallback: number): number {
  const flag = argv.find((a) => a.startsWith(`${prefix}=`));
  return Number(flag?.split("=")[1] ?? fallback);
}

export function parsePracticeAreaCliOptions(argv: string[]): PracticeAreaBatchOptions {
  return {
    limit: parseCliLimit(argv, 100),
    allowPendingWebsites: parseCliFlag(argv, "--allow-pending-websites"),
    pendingWebsiteMinConfidence: parseCliNumber(argv, "--pending-website-min-confidence", 0.95),
    debug: parseCliFlag(argv, "--debug"),
  };
}

async function loadV2WebsitesByEntity(
  entityIds: string[],
): Promise<Map<string, V2WebsiteRow[]>> {
  const map = new Map<string, V2WebsiteRow[]>();
  if (entityIds.length === 0) return map;
  try {
    const rows = await prisma.providerWebsite.findMany({
      where: { entityId: { in: entityIds } },
      select: { entityId: true, url: true, confidence: true, status: true },
    });
    for (const row of rows) {
      const list = map.get(row.entityId) ?? [];
      list.push({ url: row.url, confidence: row.confidence, status: row.status });
      map.set(row.entityId, list);
    }
  } catch {
    /* degrade — treat as no v2 websites */
  }
  return map;
}

function aggregatePracticeStats(
  batch: PracticeAreaBatchResult,
  stats: PracticeAreaExtractionResult,
): void {
  if (stats.errors.length) batch.runsFailed++;
  else batch.runsCompleted++;
  batch.recordsWritten += stats.candidatesSubmitted;
  batch.autoApproved += stats.autoApproved;
  batch.queuedForModeration += stats.pendingReview;
  batch.fetchedPages += stats.pagesFetched;
  batch.servicePagesDetected += stats.servicePagesDetected;
  batch.taxonomyMatches += stats.taxonomyMatches;
}

export async function runPracticeAreaBatch(
  opts: PracticeAreaBatchOptions,
): Promise<PracticeAreaBatchResult> {
  const limit = opts.limit ?? 100;
  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();
  const sraDocs = docs.filter((d) => d.entityType === "sra_organisation");

  const plans = planWeakProviders(sraDocs, enrichmentMap, {
    limit: limit * 3,
    sraOnly: true,
  }).filter((p) => p.missingFields.includes("practiceAreaSlugs"));

  const candidateIds = plans.slice(0, limit * 2).map((p) => p.entityId);
  const v2WebsitesByEntity = await loadV2WebsitesByEntity(candidateIds);

  const debugSamples: PracticeAreaDebugRow[] = [];

  const selected: {
    doc: LegalEntityDocument;
    enrichments: ProviderEnrichment[];
    resolution: ReturnType<typeof resolveWebsiteForPracticeExtraction>;
  }[] = [];

  for (const plan of plans) {
    const doc = sraDocs.find((d) => d.id === plan.entityId);
    if (!doc) continue;
    const enrichments = enrichmentMap.get(doc.id) ?? [];
    const resolution = resolveWebsiteForPracticeExtraction({
      enrichments,
      v2Websites: v2WebsitesByEntity.get(doc.id) ?? [],
      allowPendingWebsites: opts.allowPendingWebsites,
      pendingWebsiteMinConfidence: opts.pendingWebsiteMinConfidence,
    });

    if (opts.debug && debugSamples.length < 10) {
      debugSamples.push({
        providerId: doc.id,
        approvedWebsite: resolution.approvedWebsite ?? null,
        pendingWebsite: resolution.pendingWebsite ?? null,
        skipReason: resolution.websiteForExtraction
          ? null
          : resolution.skipReason ?? "no_approved_website",
        pagesFetched: 0,
        matches: 0,
      });
    }

    if (!resolution.websiteForExtraction) continue;
    if (selected.length >= limit) break;
    selected.push({ doc, enrichments, resolution });
  }

  const batch: PracticeAreaBatchResult = {
    stage: "extract_practice_areas",
    targets: selected.length,
    selectedProviders: selected.length,
    withApprovedWebsite: selected.filter((s) => Boolean(s.resolution.approvedWebsite)).length,
    withPendingWebsite: selected.filter(
      (s) => !s.resolution.approvedWebsite && Boolean(s.resolution.pendingWebsite),
    ).length,
    skippedNoWebsite: Math.max(0, Math.min(limit, plans.length) - selected.length),
    runsCompleted: 0,
    runsFailed: 0,
    recordsWritten: 0,
    autoApproved: 0,
    queuedForModeration: 0,
    fetchedPages: 0,
    servicePagesDetected: 0,
    taxonomyMatches: 0,
  };

  for (const { doc, enrichments, resolution } of selected) {
    const crawlRunId = await createCrawlRun({
      entityId: doc.id,
      entityType: doc.entityType,
      stage: "extract_practice_areas",
      priority: 0,
    });

    try {
      const stats = await runPracticeAreaExtractionEngine(
        doc,
        enrichments,
        crawlRunId,
        resolution,
      );
      await completeCrawlRun(crawlRunId, stats);
      aggregatePracticeStats(batch, stats);
      if (opts.debug) {
        const row = debugSamples.find((d) => d.providerId === doc.id);
        if (row) {
          row.pagesFetched = stats.pagesFetched;
          row.matches = stats.taxonomyMatches;
          row.skipReason = stats.skipReason ?? row.skipReason;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markRunForRetry(crawlRunId, msg);
      batch.runsFailed++;
      if (opts.debug && debugSamples.length < 10) {
        debugSamples.push({
          providerId: doc.id,
          approvedWebsite: resolution.approvedWebsite ?? null,
          pendingWebsite: resolution.pendingWebsite ?? null,
          skipReason: msg,
          pagesFetched: 0,
          matches: 0,
        });
      }
    }
  }

  if (opts.debug) {
    batch.debugSamples = debugSamples;
  }

  return batch;
}
