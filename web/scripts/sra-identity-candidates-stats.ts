/**
 * SRA identity candidate queue stats.
 * Usage: npm run sra:identity-candidates:stats
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { getSraIdentityCandidateStats } from "../lib/sra/missing-identity-recovery/candidate-promotion";

async function main() {
  const prisma = createPrismaClient({ quiet: true });
  try {
    const stats = await getSraIdentityCandidateStats(prisma);
    console.info(JSON.stringify(stats, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
