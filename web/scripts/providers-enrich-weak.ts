/**
 * Run full enrichment ladder on weak SRA providers.
 * Usage: npm run providers:enrich:weak -- --limit=100
 */
import "./load-dotenv";

import { planWeakProviders } from "@/lib/provider-enrichment-ladder/enrichment-planner";
import { runLadderForProvider } from "@/lib/provider-enrichment-ladder/extraction-runner";
import { loadEnrichmentMap, loadSraIndexDocuments, parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const limit = parseCliLimit(process.argv, 100);
  const missingContactOnly = process.argv.includes("--missing-contact-only");
  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();
  let plans = planWeakProviders(docs, enrichmentMap, { limit: limit * 2, sraOnly: true });
  if (missingContactOnly) {
    plans = plans.filter((p) => p.missingFields.includes("phone"));
  }
  plans = plans.slice(0, limit);

  const totals = {
    processed: 0,
    candidates: 0,
    pendingReview: 0,
    autoApproved: 0,
    rejected: 0,
    errors: [] as string[],
  };

  for (const plan of plans) {
    const doc = docs.find((d) => d.id === plan.entityId);
    if (!doc) continue;
    totals.processed++;
    const stats = await runLadderForProvider(
      doc,
      enrichmentMap.get(doc.id) ?? [],
      "full",
    );
    totals.candidates += stats.candidatesSubmitted;
    totals.pendingReview += stats.pendingReview;
    totals.autoApproved += stats.autoApproved;
    totals.rejected += stats.rejected;
    totals.errors.push(...stats.errors);
  }

  console.info(JSON.stringify({ event: "providers_enrich_weak", limit, ...totals }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
