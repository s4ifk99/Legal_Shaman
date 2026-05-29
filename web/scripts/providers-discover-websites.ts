/**
 * Discover official websites for weak SRA orgs (no crawl).
 * Usage: npm run providers:discover-websites -- --limit=100
 */
import "./load-dotenv";

import { planWeakProviders } from "@/lib/provider-enrichment-ladder/enrichment-planner";
import { runLadderForProvider } from "@/lib/provider-enrichment-ladder/extraction-runner";
import { loadEnrichmentMap, loadSraIndexDocuments, parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const limit = parseCliLimit(process.argv, 100);
  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();
  const plans = planWeakProviders(docs, enrichmentMap, { limit, sraOnly: true }).filter((p) =>
    p.missingFields.includes("website"),
  );

  let submitted = 0;
  for (const plan of plans) {
    const doc = docs.find((d) => d.id === plan.entityId);
    if (!doc) continue;
    const stats = await runLadderForProvider(
      doc,
      enrichmentMap.get(doc.id) ?? [],
      "discover_website",
    );
    submitted += stats.candidatesSubmitted;
  }

  console.info(
    JSON.stringify({ event: "providers_discover_websites", targets: plans.length, submitted }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
