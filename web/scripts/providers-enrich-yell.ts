/**
 * Enrich known SRA firms with Yell contact data (phone, website, address).
 *
 * Usage:
 *   npm run providers:enrich:yell -- --limit=50 --dry-run
 *   npm run providers:enrich:yell -- --entity=sra:921469 --debug
 *   npm run providers:enrich:yell -- --town=Ware --debug
 *   npm run providers:enrich:yell -- --postcode="S1 4SB" --debug
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import { runYellContactEnrichment } from "../lib/provider-enrichment/yell-contact-enrichment";
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
    const result = await runYellContactEnrichment(prisma, {
      limit: parseCliLimit(argv, 50),
      dryRun: argv.includes("--dry-run"),
      entityId: parseFlagValue(argv, "--entity"),
      town: parseFlagValue(argv, "--town"),
      postcode: parseFlagValue(argv, "--postcode"),
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
