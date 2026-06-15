/**
 * Reject weak pending SRA identity candidates (low score, bad domains, no SRA match).
 *
 * Usage:
 *   npm run sra:identity-candidates:cleanup-weak -- --dry-run
 *   npm run sra:identity-candidates:cleanup-weak
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { cleanupWeakIdentityCandidates } from "../lib/sra/missing-identity-recovery/cleanup-weak-candidates";

async function main() {
  const argv = process.argv;
  const prisma = createPrismaClient({ quiet: true });

  try {
    const result = await cleanupWeakIdentityCandidates(prisma, {
      dryRun: argv.includes("--dry-run"),
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
