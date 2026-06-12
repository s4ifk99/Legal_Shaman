/**
 * Promote safe pending SRA identity candidates to sra_organisations.
 *
 * Usage:
 *   npm run sra:identity-candidates:approve -- --limit=25 --dry-run
 *   npm run sra:identity-candidates:approve -- --limit=25 --skip-crawl
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { approvePendingIdentityCandidates } from "../lib/sra/missing-identity-recovery/candidate-promotion";
import { parseCliLimit } from "../lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const argv = process.argv;
  const prisma = createPrismaClient({ quiet: true });

  try {
    const result = await approvePendingIdentityCandidates(prisma, {
      limit: parseCliLimit(argv, 25),
      dryRun: argv.includes("--dry-run"),
      skipCrawl: argv.includes("--skip-crawl"),
    });

    console.info(JSON.stringify(result, null, 2));
    const exitCode =
      result.approved === 0 && result.eligible === 0 && result.examined > 0 ? 1 : 0;
    process.exit(exitCode);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
