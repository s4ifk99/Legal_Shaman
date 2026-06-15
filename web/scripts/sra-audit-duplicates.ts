/**
 * Report duplicate sra_id rows in sra_organisations (GROUP BY aggregates only).
 *
 * Usage: npm run sra:audit:duplicates
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { auditSraDuplicateIds } from "../lib/sra/sra-audit-duplicates";

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--examples="));
  const exampleLimit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  const prisma = createPrismaClient();
  try {
    const report = await auditSraDuplicateIds(prisma, {
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
