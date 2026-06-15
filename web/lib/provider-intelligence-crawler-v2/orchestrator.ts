import { planWeakProviders } from "@/lib/provider-enrichment-ladder/enrichment-planner";
import { loadEnrichmentMap, loadSraIndexDocuments, parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { completeCrawlRun, createCrawlRun } from "@/lib/provider-intelligence-crawler-v2/crawl-run";
import { claimQueuedRun, markRunForRetry } from "@/lib/provider-intelligence-crawler-v2/retry-queue";
import { listDueQueuedRuns } from "@/lib/provider-intelligence-crawler-v2/scheduler";
import type {
  CrawlerV2BatchResult,
  CrawlerV2RunStats,
  CrawlerV2Stage,
  WebsiteDiscoveryBatchResult,
  WebsiteDiscoveryRunStats,
} from "@/lib/provider-intelligence-crawler-v2/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

async function runStageEngine(
  stage: CrawlerV2Stage,
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
  crawlRunId: string,
): Promise<CrawlerV2RunStats> {
  switch (stage) {
    case "discover_website": {
      const { runWebsiteDiscoveryEngine } = await import(
        "@/lib/provider-intelligence-crawler-v2/website-discovery"
      );
      return runWebsiteDiscoveryEngine(doc, enrichments, crawlRunId);
    }
    case "extract_contacts": {
      const { runContactExtractionEngine } = await import(
        "@/lib/provider-intelligence-crawler-v2/contact-extraction"
      );
      return runContactExtractionEngine(doc, enrichments, crawlRunId);
    }
    case "extract_practice_areas": {
      const { runPracticeAreaExtractionEngine } = await import(
        "@/lib/provider-intelligence-crawler-v2/practice-area-extraction"
      );
      return runPracticeAreaExtractionEngine(doc, enrichments, crawlRunId);
    }
    case "extract_reviews": {
      const { runReviewEnrichmentEngine } = await import(
        "@/lib/provider-intelligence-crawler-v2/review-enrichment"
      );
      return runReviewEnrichmentEngine(doc, enrichments, crawlRunId);
    }
    case "ai_enrich": {
      const { runAiEnrichmentEngine } = await import(
        "@/lib/provider-intelligence-crawler-v2/ai-classification"
      );
      return runAiEnrichmentEngine(doc, enrichments, crawlRunId);
    }
    default:
      return {
        candidatesSubmitted: 0,
        autoApproved: 0,
        pendingReview: 0,
        rejected: 0,
        errors: [`unknown_stage:${stage}`],
      };
  }
}

export async function runCrawlerV2ForEntity(
  doc: LegalEntityDocument,
  stage: CrawlerV2Stage,
  enrichments: import("@/lib/provider-enrichment/types").ProviderEnrichment[],
  opts?: { crawlRunId?: string },
): Promise<{ crawlRunId: string; stats: CrawlerV2RunStats }> {
  const crawlRunId =
    opts?.crawlRunId ??
    (await createCrawlRun({
      entityId: doc.id,
      entityType: doc.entityType,
      stage,
      priority: 0,
    }));

  try {
    const stats = await runStageEngine(stage, doc, enrichments, crawlRunId);
    await completeCrawlRun(crawlRunId, stats);
    return { crawlRunId, stats };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markRunForRetry(crawlRunId, msg);
    return {
      crawlRunId,
      stats: {
        candidatesSubmitted: 0,
        autoApproved: 0,
        pendingReview: 0,
        rejected: 0,
        errors: [msg],
      },
    };
  }
}

export type CrawlerV2BatchOptions = {
  stage: CrawlerV2Stage;
  limit?: number;
  /** When set, only providers missing this field (weak-provider planner). */
  missingField?: "website" | "phone" | "email" | "practiceAreaSlugs";
  processQueue?: boolean;
};

export async function runCrawlerV2Batch(
  opts: CrawlerV2BatchOptions,
): Promise<CrawlerV2BatchResult | WebsiteDiscoveryBatchResult> {
  const limit = opts.limit ?? parseCliLimit(process.argv, 100);
  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();

  let targets: LegalEntityDocument[] = docs.filter((d) => d.entityType === "sra_organisation");

  if (opts.missingField) {
    const plans = planWeakProviders(docs, enrichmentMap, { limit: limit * 2, sraOnly: true }).filter(
      (p) => p.missingFields.includes(opts.missingField!),
    );
    const ids = new Set(plans.slice(0, limit).map((p) => p.entityId));
    targets = docs.filter((d) => ids.has(d.id));
  } else {
    targets = targets.slice(0, limit);
  }

  const result: CrawlerV2BatchResult | WebsiteDiscoveryBatchResult =
    opts.stage === "discover_website"
      ? {
          stage: opts.stage,
          targets: targets.length,
          runsCompleted: 0,
          runsFailed: 0,
          recordsWritten: 0,
          autoApproved: 0,
          queuedForModeration: 0,
          pendingReview: 0,
          candidatesFound: 0,
          regulatoryRejected: 0,
          directoryRejected: 0,
          rejectedSynthetic: 0,
          rejectedUnverified: 0,
          noCandidate: 0,
          firmNamesUsed: 0,
          searchQueriesBuilt: 0,
          searchResultsSeen: 0,
          candidatesVerified: 0,
        }
      : {
          stage: opts.stage,
          targets: targets.length,
          runsCompleted: 0,
          runsFailed: 0,
          recordsWritten: 0,
          autoApproved: 0,
          queuedForModeration: 0,
        };

  if (opts.processQueue) {
    const queued = await listDueQueuedRuns(limit);
    for (const q of queued) {
      const doc = docs.find((d) => d.id === q.entityId);
      if (!doc) continue;
      const claimed = await claimQueuedRun(q.id);
      if (!claimed) continue;
      const { stats } = await runCrawlerV2ForEntity(
        doc,
        q.stage,
        enrichmentMap.get(doc.id) ?? [],
        { crawlRunId: q.id },
      );
      aggregateStats(result, stats);
    }
    return result;
  }

  for (const doc of targets) {
    const { stats } = await runCrawlerV2ForEntity(
      doc,
      opts.stage,
      enrichmentMap.get(doc.id) ?? [],
    );
    aggregateStats(result, stats);
  }

  return result;
}

function aggregateStats(
  batch: CrawlerV2BatchResult | WebsiteDiscoveryBatchResult,
  stats: CrawlerV2RunStats,
): void {
  if (stats.errors.length) batch.runsFailed++;
  else batch.runsCompleted++;
  batch.recordsWritten += stats.candidatesSubmitted;
  batch.autoApproved += stats.autoApproved;
  batch.queuedForModeration += stats.pendingReview;

  if (batch.stage === "discover_website" && "candidatesFound" in batch) {
    const ws = stats as WebsiteDiscoveryRunStats;
    batch.candidatesFound += ws.candidatesFound ?? 0;
    batch.regulatoryRejected += ws.regulatoryRejected ?? 0;
    batch.directoryRejected += ws.directoryRejected ?? 0;
    batch.rejectedSynthetic += ws.rejectedSynthetic ?? 0;
    batch.rejectedUnverified += ws.rejectedUnverified ?? 0;
    batch.noCandidate += ws.noCandidate ?? 0;
    batch.firmNamesUsed += ws.firmNamesUsed ?? 0;
    batch.searchQueriesBuilt += ws.searchQueriesBuilt ?? 0;
    batch.searchResultsSeen += ws.searchResultsSeen ?? 0;
    batch.candidatesVerified += ws.candidatesVerified ?? 0;
    batch.pendingReview = batch.queuedForModeration;
  }
}
