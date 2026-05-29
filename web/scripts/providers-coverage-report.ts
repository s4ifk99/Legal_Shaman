/**
 * Provider coverage / enrichment ladder report.
 * Usage: npm run providers:coverage-report
 */
import "./load-dotenv";

import { buildCoverageLadderReport } from "@/lib/provider-enrichment-ladder/coverage-report";
import { loadEnrichmentMap, loadSraIndexDocuments } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const docs = await loadSraIndexDocuments();
  const enrichmentMap = await loadEnrichmentMap();
  const report = await buildCoverageLadderReport(docs, enrichmentMap);

  console.info(JSON.stringify({ event: "providers_coverage_report", ...report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
