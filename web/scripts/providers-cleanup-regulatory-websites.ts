import "./load-dotenv";

import {
  cleanupRegulatoryWebsitesExitCode,
  runCleanupRegulatoryWebsites,
} from "@/lib/provider-intelligence-crawler-v2/cleanup-regulatory-websites";
import { parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const result = await runCleanupRegulatoryWebsites({
    dryRun: process.argv.includes("--dry-run"),
    limit: parseCliLimit(process.argv, 10_000),
  });
  console.info(JSON.stringify(result, null, 2));
  process.exitCode = cleanupRegulatoryWebsitesExitCode(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
