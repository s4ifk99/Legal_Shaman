/**
 * Reject Yell SRA identity candidates and revert org names set from Yell.
 *
 * Usage:
 *   npm run sra:identity-candidates:cleanup-yell -- --dry-run
 *   npm run sra:identity-candidates:cleanup-yell
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { cleanupYellIdentityCandidates } from "../lib/sra/missing-identity-recovery/cleanup-yell-identity-candidates";

async function main() {
  const prisma = createPrismaClient({ quiet: true });
  try {
    const result = await cleanupYellIdentityCandidates(prisma, {
      dryRun: process.argv.includes("--dry-run"),
    });
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
