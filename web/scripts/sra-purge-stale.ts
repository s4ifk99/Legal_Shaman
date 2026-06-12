/**
 * Archive and remove SRA organisations not in the latest GetAll snapshot.
 *
 * Usage:
 *   npm run sra:purge-stale -- --dry-run
 *   npm run sra:purge-stale -- --from-snapshot
 */
import "./load-dotenv";

import { createPrismaClient } from "../lib/db/prisma";
import {
  purgeStaleSraOrganisations,
  readActiveSraIdSnapshot,
} from "../lib/sra/purge-stale-organisations";
import {
  activeSraIdsFromGetAllRows,
  fetchAllOrganisationsFromApi,
} from "../lib/sra/sra-fetch";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const dryRun = hasFlag("dry-run");
  const fromSnapshot = hasFlag("from-snapshot");
  const skipTypesense = hasFlag("skip-typesense");

  let activeSraIds: string[];

  if (fromSnapshot) {
    activeSraIds = await readActiveSraIdSnapshot();
    if (activeSraIds.length === 0) {
      console.error("No .sra-sync-active-ids.json snapshot found — run sra:sync first.");
      process.exit(1);
    }
    console.info(`Using snapshot with ${activeSraIds.length} active SRA ids.`);
  } else {
    const key = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
    if (!key) {
      console.error("Missing SRA_APIM_SUBSCRIPTION_KEY");
      process.exit(1);
    }
    console.info("Fetching current SRA GetAll for active id set…");
    const rows = await fetchAllOrganisationsFromApi(key);
    activeSraIds = activeSraIdsFromGetAllRows(rows);
    console.info(`GetAll returned ${activeSraIds.length} organisations.`);
  }

  const prisma = createPrismaClient();
  try {
    const result = await purgeStaleSraOrganisations(prisma, {
      activeSraIds,
      dryRun,
      skipTypesense,
    });
    console.info(JSON.stringify({ event: "sra_purge_stale", ...result }, null, 2));
    if (!dryRun && result.staleCount > 0 && !skipTypesense) {
      console.info("Run npm run search:index:sra to refresh the search index if needed.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
