/**
 * Contact extraction via Provider Intelligence Crawler v2.
 * Usage: npm run providers:crawl:contacts -- --limit=100
 */
import "./load-dotenv";

import { runCrawlerV2Batch } from "@/lib/provider-intelligence-crawler-v2/orchestrator";
import { parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const limit = parseCliLimit(process.argv, 100);
  const result = await runCrawlerV2Batch({
    stage: "extract_contacts",
    limit,
    missingField: "phone",
  });
  console.info(JSON.stringify({ event: "providers_crawl_contacts", ...result }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
