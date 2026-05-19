/**
 * Re-run firm <-> SRA name matching. Idempotent: only touches firms with
 * `sraId IS NULL`. Use after editing firm names or after a partial sync.
 *
 * Usage: cd web && npm run sra:link-firms
 */

import "./load-dotenv";
import { linkFirmsToSra } from "../lib/sra/link-firms";
import { prisma } from "../lib/db/prisma";

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL not set — cannot connect to Postgres.");
    process.exit(1);
  }
  const result = await linkFirmsToSra();
  console.log(
    `Done. linked=${result.linked}, skipped=${result.skipped}, ambiguous=${result.ambiguous}.`,
  );
}

void main()
  .catch((err) => {
    console.error("[sra:link-firms] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
