/**
 * Review SRA ids with multiple competing pending identity candidates.
 *
 * Usage:
 *   npm run sra:identity-candidates:competing -- --limit=50
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { reviewCompetingIdentityCandidates } from "../lib/sra/missing-identity-recovery/competing-candidates-review";
import { parseCliLimit } from "../lib/provider-enrichment-ladder/ladder-cli";

async function main() {
  const argv = process.argv;
  const prisma = createPrismaClient({ quiet: true });

  try {
    const result = await reviewCompetingIdentityCandidates(prisma, {
      limit: parseCliLimit(argv, 50),
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
