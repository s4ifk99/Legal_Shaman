/**
 * List pending extracted fields for admin review.
 */
import "./load-dotenv";

import { loadPendingExtractedFieldsSafe } from "@/lib/provider-crawler/crawl-review-datasource";
import {
  buildProvidersCrawlReviewOutput,
  providersCrawlReviewExitCode,
} from "@/lib/provider-crawler/crawl-review-output";
import { listQueuedCrawlJobs } from "@/lib/provider-crawler/review-queue";

async function main() {
  const pending = await loadPendingExtractedFieldsSafe(100);
  const jobs = pending.ok ? await listQueuedCrawlJobs(50) : [];
  const output = buildProvidersCrawlReviewOutput({
    pending,
    queuedJobs: pending.ok ? jobs.length : undefined,
  });
  console.info(JSON.stringify(output));
  process.exitCode = providersCrawlReviewExitCode(output);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
