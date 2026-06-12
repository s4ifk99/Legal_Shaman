import "./load-dotenv";

import {
  approveWebsitesExitCode,
  runApproveWebsites,
} from "@/lib/provider-intelligence-crawler-v2/approve-websites";
import { parseCliLimit } from "@/lib/provider-enrichment-ladder/ladder-cli";

function parseMinConfidence(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--min-confidence="));
  return Number(flag?.split("=")[1] ?? 0.95);
}

async function main() {
  const result = await runApproveWebsites({
    limit: parseCliLimit(process.argv, 100),
    minConfidence: parseMinConfidence(process.argv),
    dryRun: process.argv.includes("--dry-run"),
  });
  console.info(JSON.stringify(result, null, 2));
  process.exitCode = approveWebsitesExitCode(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
