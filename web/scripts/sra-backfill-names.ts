/**
 * Backfill real firm names for placeholder SRA organisations via SRA Register lookup.
 * Usage: npm run sra:backfill:names -- --limit=100 --only-placeholders --dry-run
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import { runSraNameBackfill } from "../lib/sra/register-name-backfill";
import { parseCliLimit } from "../lib/provider-enrichment-ladder/ladder-cli";

function parseOffset(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--offset="));
  return Number(flag?.split("=")[1] ?? 0);
}

async function main() {
  const result = await runSraNameBackfill(prisma, {
    limit: parseCliLimit(process.argv, 100),
    offset: parseOffset(process.argv),
    onlyPlaceholders: !process.argv.includes("--all"),
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force"),
    resume: process.argv.includes("--resume"),
    debug: process.argv.includes("--debug"),
  });

  console.info(JSON.stringify(result, null, 2));
  process.exitCode = result.failed > result.lookedUp / 2 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
