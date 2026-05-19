/**
 * SRA sync and index diagnostics.
 * Run: cd web && npm run sra:status
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import { getCatalogStats } from "../lib/search-index/catalog-stats";
import { readSraSyncState } from "../lib/sra/sync-state";
import { buildTypesenseListingsClientFromEnv } from "../lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "../lib/search-index/config";
import { collectIndexBalanceReport } from "../lib/search-index/index-balance-diagnostics";
import { enableTypesenseUnified } from "../lib/legal-search/config";

async function countFamilySraInPg(): Promise<number> {
  try {
    return await prisma.sraOrganisation.count({
      where: {
        OR: [
          { searchText: { contains: "family", mode: "insensitive" } },
          { searchText: { contains: "divorce", mode: "insensitive" } },
          { searchText: { contains: "matrimonial", mode: "insensitive" } },
        ],
      },
    });
  } catch {
    return 0;
  }
}

async function main() {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL ${msg}`);
    failed++;
  };

  const apiKey = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
  console.info(`SRA API configured: ${apiKey ? "yes" : "no"}`);
  if (!apiKey) fail("SRA_APIM_SUBSCRIPTION_KEY not set");

  const sync = await readSraSyncState();
  console.info(`Last successful SRA sync: ${sync.lastSuccessAt ?? "never"}`);
  if (sync.errors.length) {
    console.info(`Sync errors (${sync.errors.length}): ${sync.errors.slice(0, 5).join("; ")}`);
  } else {
    console.info("Sync errors: none");
  }

  let pgCount: number | null = null;
  try {
    pgCount = await prisma.sraOrganisation.count();
    console.info(`SRA orgs in Postgres (sra_organisations): ${pgCount}`);
    if (pgCount === 0) fail("no SRA organisations in Postgres");
  } catch (e) {
    fail(`Postgres unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }

  const familyPg = await countFamilySraInPg();
  console.info(`SRA orgs with family/divorce signals in Postgres: ${familyPg}`);

  const stats = await getCatalogStats();
  console.info(`SRA orgs in Typesense (entityType filter): ${stats.sraTypesenseCount ?? "n/a"}`);
  console.info(`Legal entities total: ${stats.legalEntitiesTotal ?? "n/a"}`);
  console.info(`Legal aid providers in index: ${stats.legalAidProviderCount ?? "n/a"}`);
  console.info(`Typesense unified search enabled: ${enableTypesenseUnified() ? "yes" : "no"}`);

  const balance = await collectIndexBalanceReport();
  if (balance) {
    console.info(`SRA docs in legal_entities: ${balance.byEntityType.sra_organisation ?? 0}`);
    console.info(`SRA family practiceAreaSlugs: ${balance.familySraCount}`);
    console.info(
      `Family private/SRA/curated/lawyer in index: ${balance.familyPrivateFacingCount}`,
    );
    if ((balance.byEntityType.sra_organisation ?? 0) === 0 && (pgCount ?? 0) > 0) {
      fail("SRA orgs in Postgres but none indexed — run npm run search:index:sra");
    }
    if (balance.familyPrivateFacingCount === 0) {
      console.warn(
        "WARN: no private/SRA family entities in index — divorce/family private searches will show coverage notice",
      );
    }
  }

  const client = buildTypesenseListingsClientFromEnv();
  if (client && pgCount && pgCount > 0) {
    try {
      const sample = await prisma.sraOrganisation.findFirst({ select: { sraId: true } });
      if (sample) {
        const docId = `sra:${sample.sraId}`;
        await client.collections(LEGAL_ENTITIES_COLLECTION).documents(docId).retrieve();
        console.info(`Sample SRA doc indexed: ${docId}`);
      }
    } catch {
      fail(`sample SRA org not found in Typesense (run npm run search:index:sra)`);
    }
  }

  if (failed) process.exit(1);
  console.info("sra:status OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
