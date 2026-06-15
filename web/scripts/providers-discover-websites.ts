/**
 * Discover official websites for weak SRA orgs (Crawler v2).
 * Usage: npm run providers:discover-websites -- --limit=100 [--debug] [--only-valid-names]
 */
import "./load-dotenv";

import { planWeakProviders } from "@/lib/provider-enrichment-ladder/enrichment-planner";
import {
  loadEnrichmentMap,
  loadSraIndexDocuments,
  parseCliLimit,
} from "@/lib/provider-enrichment-ladder/ladder-cli";
import { createCrawlRun, completeCrawlRun } from "@/lib/provider-intelligence-crawler-v2/crawl-run";
import {
  runWebsiteDiscoveryEngine,
  type WebsiteDiscoveryDebugRow,
} from "@/lib/provider-intelligence-crawler-v2/website-discovery";
import { enrichFirmNameSeedFromPostgres, sraIdFromEntityId } from "@/lib/provider-osint/firm-name-seed";
import { buildFirmWebsiteSearchQueries } from "@/lib/provider-osint/firm-search-queries";
import {
  INVALID_FIRM_NAME_SEED_REASON,
  rejectFirmNameSeed,
} from "@/lib/provider-osint/firm-name-seed-validation";
import { emptyWebsiteDiscoveryTrace } from "@/lib/provider-osint/search-website-discovery";
import { emptyWebsiteDiscoveryDiagnostics } from "@/lib/provider-osint/website-discovery";
import type { WebsiteDiscoveryBatchResult } from "@/lib/provider-intelligence-crawler-v2/types";

async function main() {
  const limit = parseCliLimit(process.argv, 100);
  const debug = process.argv.includes("--debug");
  const onlyValidNames = process.argv.includes("--only-valid-names");

  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();
  const planPool = onlyValidNames ? limit * 8 : limit * 2;
  const plans = planWeakProviders(docs, enrichmentMap, { limit: planPool, sraOnly: true }).filter(
    (p) => p.missingFields.includes("website"),
  );
  const planIds = plans.map((p) => p.entityId);
  let targets = docs.filter((d) => planIds.includes(d.id));

  if (onlyValidNames) {
    const valid: typeof targets = [];
    for (const d of targets) {
      const seed = await enrichFirmNameSeedFromPostgres(d);
      const sraId = seed?.sraId ?? sraIdFromEntityId(d.id);
      if (seed && rejectFirmNameSeed(seed.primaryName, sraId).valid) {
        valid.push(d);
      }
      if (valid.length >= limit) break;
    }
    targets = valid;
  } else {
    const ids = new Set(planIds.slice(0, limit));
    targets = targets.filter((d) => ids.has(d.id));
  }

  const batch: WebsiteDiscoveryBatchResult = {
    stage: "discover_website",
    targets: targets.length,
    runsCompleted: 0,
    runsFailed: 0,
    recordsWritten: 0,
    queuedForModeration: 0,
    ...emptyWebsiteDiscoveryDiagnostics(),
    autoApproved: 0,
    pendingReview: 0,
  };

  const debugRows: WebsiteDiscoveryDebugRow[] = [];

  for (const doc of targets) {
    const seed = await enrichFirmNameSeedFromPostgres(doc);
    const trace = emptyWebsiteDiscoveryTrace(
      doc.id,
      seed?.primaryName ?? doc.displayName ?? doc.title,
    );
    const sraId = seed?.sraId ?? sraIdFromEntityId(doc.id);
    if (seed) {
      const seedCheck = rejectFirmNameSeed(seed.primaryName, sraId);
      if (!seedCheck.valid) {
        trace.rejectReason = INVALID_FIRM_NAME_SEED_REASON;
        trace.queries = [];
        trace.noCandidate = true;
      } else {
        batch.firmNamesUsed++;
        trace.queries = buildFirmWebsiteSearchQueries(seed);
        batch.searchQueriesBuilt += trace.queries.length;
      }
    } else {
      trace.rejectReason = INVALID_FIRM_NAME_SEED_REASON;
      trace.noCandidate = true;
    }

    const crawlRunId = await createCrawlRun({
      entityId: doc.id,
      entityType: doc.entityType,
      stage: "discover_website",
      priority: 0,
    });

    try {
      const stats = await runWebsiteDiscoveryEngine(
        doc,
        enrichmentMap.get(doc.id) ?? [],
        crawlRunId,
        { debugTrace: debug ? trace : undefined },
      );

      await completeCrawlRun(crawlRunId, stats);

      if (stats.errors.length) batch.runsFailed++;
      else batch.runsCompleted++;

      batch.recordsWritten += stats.candidatesSubmitted;
      batch.autoApproved += stats.autoApproved;
      batch.pendingReview += stats.pendingReview;
      batch.queuedForModeration += stats.pendingReview;
      batch.candidatesFound += stats.candidatesFound;
      batch.candidatesCollected += stats.candidatesCollected;
      batch.candidatesRejected += stats.candidatesRejected;
      batch.regulatoryRejected += stats.regulatoryRejected;
      batch.directoryRejected += stats.directoryRejected;
      batch.rejectedSynthetic += stats.rejectedSynthetic;
      batch.rejectedUnverified += stats.rejectedUnverified;
      batch.noCandidate += stats.noCandidate;
      batch.searchResultsSeen += stats.searchResultsSeen;
      batch.candidatesVerified += stats.candidatesVerified;

      if (debug) debugRows.push(trace);
    } catch (e) {
      batch.runsFailed++;
      if (debug) {
        trace.finalDecision = `error:${e instanceof Error ? e.message : String(e)}`;
        debugRows.push(trace);
      }
    }
  }

  const payload: Record<string, unknown> = {
    event: "providers_discover_websites",
    ...batch,
    summary: {
      candidatesCollected: batch.candidatesCollected,
      candidatesVerified: batch.candidatesVerified,
      candidatesRejected: batch.candidatesRejected,
      noCandidate: batch.noCandidate,
    },
  };
  if (debug) payload.debug = debugRows;

  console.info(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
