/**
 * Discover solicitor businesses in a town/postcode via Yell (review queue, no SRA overwrite).
 *
 * Usage:
 *   npm run providers:discover:yell-town -- --town="Ware" --limit=50 --dry-run
 *   npm run providers:discover:yell-town -- --postcode="SG12" --dry-run
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { runYellTownDiscovery } from "../lib/provider-enrichment/yell-town-discovery";
import { parseCliLimit } from "../lib/provider-enrichment-ladder/ladder-cli";

function parseFlagValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split("=")[1]?.trim();
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1]!.trim();
  }
  return undefined;
}

async function main() {
  const argv = process.argv;
  const prisma = createPrismaClient({ quiet: true });
  try {
    const result = await runYellTownDiscovery(prisma, {
      town: parseFlagValue(argv, "--town"),
      postcode: parseFlagValue(argv, "--postcode"),
      limit: parseCliLimit(argv, 50),
      dryRun: argv.includes("--dry-run"),
      debug: argv.includes("--debug"),
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
