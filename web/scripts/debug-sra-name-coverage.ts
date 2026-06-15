/**
 * Audit SRA organisation name quality in Postgres.
 * Usage: npm run debug:sra-name-coverage
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import { buildSraNameCoverageReport } from "../lib/sra/name-coverage-audit";

async function main() {
  const report = await buildSraNameCoverageReport(prisma);
  console.info(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
