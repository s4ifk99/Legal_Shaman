/**
 * Sample placeholder rows and compare local sra_id against live SRA GetAll Id vs SraNumber.
 *
 * Usage: npm run sra:audit:legacy-id-mismatch
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { auditSraLegacyIdMismatch } from "../lib/sra/sra-audit-legacy-id-mismatch";

async function main() {
  const key = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
  if (!key) {
    console.error("Missing SRA_APIM_SUBSCRIPTION_KEY");
    process.exit(1);
  }

  const sampleArg = process.argv.find((a) => a.startsWith("--sample="));
  const sampleSize = sampleArg ? Number(sampleArg.split("=")[1]) : undefined;

  const prisma = createPrismaClient();
  try {
    const report = await auditSraLegacyIdMismatch(prisma, key, {
      sampleSize: Number.isFinite(sampleSize) ? sampleSize : undefined,
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
