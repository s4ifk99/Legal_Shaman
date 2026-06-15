/**
 * Find logical duplicate SRA organisations across different sra_id values.
 *
 * Usage: npm run sra:audit:logical-duplicates
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { auditSraLogicalDuplicates } from "../lib/sra/sra-audit-logical-duplicates";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--examples="));
  const exampleLimit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  const prisma = createPrismaClient();
  try {
    const report = await auditSraLogicalDuplicates(prisma, {
      exampleLimit: Number.isFinite(exampleLimit) ? exampleLimit : undefined,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
