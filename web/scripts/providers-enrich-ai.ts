import "./load-dotenv";

import { runCrawlerV2Batch } from "@/lib/provider-intelligence-crawler-v2/orchestrator";
import { parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const limit = parseCliLimit(process.argv, 40);
  const result = await runCrawlerV2Batch({ stage: "ai_enrich", limit });
  console.info(JSON.stringify({ event: "providers_enrich_ai", ...result }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
