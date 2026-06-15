/**
 * Provider crawler CLI (compliant enrichment).
 * Usage: npm run providers:crawl [-- contacts|capabilities|trustpilot|testimonials|all] [--limit=N]
 */
import "./load-dotenv";

import {
  buildCuratedDocuments,
  buildLegalAidDocuments,
  buildLawyerDocuments,
  buildProBonoDocuments,
  buildSraDocuments,
} from "@/lib/search-index/build-legal-entity-doc";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { crawlProviderDocument } from "@/lib/provider-crawler/crawler";
import type { CrawlMode } from "@/lib/provider-crawler/types";
import { queueCrawlJob } from "@/lib/provider-crawler/review-queue";

process.env.PROVIDER_CRAWL_SKIP_FETCH ??= "1";

function parseLimit(argv: string[]): number {
  const eq = argv.find((a) => a.startsWith("--limit="));
  if (eq) return Number(eq.split("=")[1]) || 50;
  const idx = argv.indexOf("--limit");
  if (idx >= 0 && argv[idx + 1]) return Number(argv[idx + 1]) || 50;
  return 50;
}

/** Load providers incrementally until enough crawl targets are found (avoids 50k SRA geocode). */
async function collectCrawlTargets(
  limit: number,
  mode: CrawlMode,
): Promise<LegalEntityDocument[]> {
  const targets: LegalEntityDocument[] = [];
  const seen = new Set<string>();

  const wantDoc = (d: LegalEntityDocument): boolean => {
    if (mode === "capabilities" || mode === "trustpilot") return true;
    return !d.phone || !d.email;
  };

  const addFrom = (docs: LegalEntityDocument[]) => {
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      if (!wantDoc(d)) continue;
      seen.add(d.id);
      targets.push(d);
      if (targets.length >= limit) return;
    }
  };

  const skipGeo = { skipGeo: true };
  addFrom(await buildCuratedDocuments(skipGeo));
  if (targets.length >= limit) return targets;

  addFrom(await buildLegalAidDocuments(skipGeo));
  if (targets.length >= limit) return targets;

  addFrom(await buildLawyerDocuments());
  if (targets.length >= limit) return targets;

  addFrom(await buildProBonoDocuments());
  if (targets.length >= limit) return targets;

  addFrom(
    await buildSraDocuments({
      take: Math.max(limit * 20, 100),
      skipGeo: true,
    }),
  );

  return targets;
}

async function main() {
  const argv = process.argv.slice(2);
  const modeArg = argv.find((a) => !a.startsWith("--")) ?? "all";
  const mode: CrawlMode =
    modeArg === "contacts" ||
    modeArg === "capabilities" ||
    modeArg === "trustpilot" ||
    modeArg === "testimonials"
      ? modeArg
      : "all";
  const limit = parseLimit(argv);
  const queueOnly = argv.includes("--queue");

  const targets = await collectCrawlTargets(limit, mode);

  const totals = {
    scanned: 0,
    pagesFetched: 0,
    pagesSkipped: 0,
    fieldsFound: 0,
    pendingReview: 0,
    autoApproved: 0,
    rejected: 0,
    errors: [] as string[],
  };

  for (const doc of targets) {
    totals.scanned++;
    if (queueOnly) {
      await queueCrawlJob(doc.id, doc.entityType, mode, doc.website ?? doc.profileUrl);
      continue;
    }
    const jobId = await queueCrawlJob(doc.id, doc.entityType, mode, doc.website ?? doc.profileUrl);
    const stats = await crawlProviderDocument(doc, mode, jobId ? { jobId } : undefined);
    totals.pagesFetched += stats.pagesFetched;
    totals.pagesSkipped += stats.pagesSkipped;
    totals.fieldsFound += stats.fieldsFound;
    totals.pendingReview += stats.pendingReview;
    totals.autoApproved += stats.autoApproved;
    totals.rejected += stats.rejected;
    totals.errors.push(...stats.errors);
  }

  console.info(
    JSON.stringify({
      event: "providers_crawl",
      mode,
      queueOnly,
      targets: targets.length,
      ...totals,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
