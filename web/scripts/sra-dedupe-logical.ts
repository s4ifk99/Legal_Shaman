/**
 * Safely merge legacy placeholder SRA rows into real SraNumber-keyed rows.
 *
 * Usage:
 *   npm run sra:dedupe-logical -- --dry-run
 *   npm run sra:dedupe-logical -- --limit=100 --dry-run
 *   npm run sra:dedupe-logical -- --limit=100 --confirm
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { runSraLogicalDedupe } from "../lib/sra/sra-logical-dedupe";

function parseLimit(argv: string[]): number {
  const arg = argv.find((a) => a.startsWith("--limit="));
  if (!arg) return 500;
  const n = Number(arg.split("=")[1]);
  if (!Number.isFinite(n) || n < 1) {
    console.error("Invalid --limit value");
    process.exit(1);
  }
  return Math.floor(n);
}

async function main() {
  const argv = process.argv;
  const confirm = argv.includes("--confirm");
  const dryRun = argv.includes("--dry-run") || !confirm;
  const limit = parseLimit(argv);

  if (!dryRun && !confirm) {
    console.error("Refusing to delete rows without --confirm. Use --dry-run to preview.");
    process.exit(1);
  }

  if (dryRun) {
    console.log("DRY RUN — no rows deleted; audit rows marked dryRun=true.");
  } else {
    console.log("LIVE RUN — placeholder rows will be merged and deleted.");
  }

  const prisma = createPrismaClient();
  try {
    const report = await runSraLogicalDedupe(prisma, { limit, dryRun });
    console.log(JSON.stringify(report, null, 2));
    if (!dryRun && report.deletedRows === 0 && report.mergeable === 0) {
      process.exit(0);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
