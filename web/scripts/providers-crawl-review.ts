/**
 * List pending extracted fields for admin review.
 */
import "./load-dotenv";

import { listPendingExtractedFields, listQueuedCrawlJobs } from "@/lib/provider-crawler/review-queue";

async function main() {
  const pending = await listPendingExtractedFields(100);
  const jobs = await listQueuedCrawlJobs(50);
  console.info(
    JSON.stringify({
      event: "providers_crawl_review",
      pendingCount: pending.length,
      queuedJobs: jobs.length,
      pending: pending.slice(0, 20),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
