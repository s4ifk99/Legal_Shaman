import "./load-dotenv";

import { prisma } from "@/lib/db/prisma";
import { cleanupBadRecoveredDisplayNames } from "@/lib/sra/cleanup-bad-display-names";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  const result = await cleanupBadRecoveredDisplayNames(prisma, { dryRun, limit });
  console.info(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
