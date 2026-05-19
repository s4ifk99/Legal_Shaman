/**
 * List pending provider enrichments for admin review.
 */
import "./load-dotenv";

import { listPendingEnrichments } from "@/lib/provider-enrichment/review-queue";

async function main() {
  const pending = await listPendingEnrichments(100);
  console.info(JSON.stringify({ event: "provider_enrichment_review", count: pending.length, pending }, null, 2));
  console.info(`Open /admin/provider-enrichment to approve or reject (${pending.length} pending).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
