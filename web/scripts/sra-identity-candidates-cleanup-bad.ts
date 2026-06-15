/**
 * Reject bad auto-approved identity candidates and revert affected org names.
 *
 * Usage:
 *   npm run sra:identity-candidates:cleanup-bad -- --dry-run
 *   npm run sra:identity-candidates:cleanup-bad
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { cleanupBadIdentityCandidates } from "../lib/sra/missing-identity-recovery/cleanup-bad-candidates";

async function main() {
  const argv = process.argv;
  const prisma = createPrismaClient({ quiet: true });

  try {
    const result = await cleanupBadIdentityCandidates(prisma, {
      dryRun: argv.includes("--dry-run"),
    });
    console.info(JSON.stringify(result, null, 2));
    process.exit(result.rejected > 0 ? 0 : 0);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
