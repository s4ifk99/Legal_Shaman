/**
 * Restore a merged SRA row from sra_logical_dedupe_audit.
 *
 * Usage: npm run sra:dedupe-logical:restore -- --audit-id=<cuid>
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { restoreSraLogicalDedupe } from "../lib/sra/sra-logical-dedupe-restore";

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--audit-id="));
  const auditId = arg?.split("=")[1]?.trim();
  if (!auditId) {
    console.error("Missing --audit-id=<id>");
    process.exit(1);
  }

  const prisma = createPrismaClient();
  try {
    const result = await restoreSraLogicalDedupe(prisma, auditId);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
