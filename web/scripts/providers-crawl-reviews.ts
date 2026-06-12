import "./load-dotenv";

import { runCrawlerV2Batch } from "@/lib/provider-intelligence-crawler-v2/orchestrator";
import { parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const limit = parseCliLimit(process.argv, 50);
  const result = await runCrawlerV2Batch({ stage: "extract_reviews", limit });
  console.info(JSON.stringify({ event: "providers_crawl_reviews", ...result }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
