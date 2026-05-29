/**
 * Extract practice areas from firm websites for weak SRA orgs.
 * Usage: npm run providers:extract-practice-areas -- --limit=100
 */
import "./load-dotenv";

import { planWeakProviders } from "@/lib/provider-enrichment-ladder/enrichment-planner";
import { runLadderForProvider } from "@/lib/provider-enrichment-ladder/extraction-runner";
import { loadEnrichmentMap, loadSraIndexDocuments, parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const limit = parseCliLimit(process.argv, 100);
  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();
  const plans = planWeakProviders(docs, enrichmentMap, { limit, sraOnly: true });

  let processed = 0;
  let candidates = 0;
  for (const plan of plans) {
    const doc = docs.find((d) => d.id === plan.entityId);
    if (!doc) continue;
    if (!doc.website && !plan.website) continue;
    processed++;
    const stats = await runLadderForProvider(
      doc,
      enrichmentMap.get(doc.id) ?? [],
      "extract_practice_areas",
    );
    candidates += stats.candidatesSubmitted;
  }

  console.info(
    JSON.stringify(
      { event: "providers_extract_practice_areas", processed, candidates },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
