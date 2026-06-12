/**
 * Overnight provider enrichment — weak SRA orgs through crawler v2 stages in batches.
 *
 * Usage:
 *   npm run providers:overnight -- --batch-size=1000 --resume
 *   npm run providers:overnight -- --batch-size=500
 *
 * Checkpoint: .cache/providers-overnight/checkpoint.json
 */
import "./load-dotenv";

import { runProvidersOvernight } from "@/lib/provider-intelligence-crawler-v2/overnight-run";

function parseBatchSize(argv: string[]): number | undefined {
  const flag = argv.find((a) => a.startsWith("--batch-size="));
  if (!flag) return undefined;
  const n = Number(flag.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseDelayMs(argv: string[]): number | undefined {
  const flag = argv.find((a) => a.startsWith("--delay-ms="));
  if (!flag) return undefined;
  const n = Number(flag.split("=")[1]);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function main() {
  const argv = process.argv;
  const result = await runProvidersOvernight({
    batchSize: parseBatchSize(argv) ?? 1000,
    resume: argv.includes("--resume"),
    delayBetweenMs: parseDelayMs(argv),
  });

  console.info(JSON.stringify(result, null, 2));
  process.exitCode = result.targets === 0 ? 0 : result.runsFailed > result.runsCompleted ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
