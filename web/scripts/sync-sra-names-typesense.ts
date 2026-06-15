/**
 * Backfill SRA display names in Postgres and patch Typesense titles (minimal partial updates).
 * Run: npm run search:index:sra:names -- --limit=25 --debug
 * Full Postgres backfill (optional): npm run search:index:sra:names -- --with-backfill
 */
import "./load-dotenv";

import { prisma } from "../lib/db/prisma";
import { formatDatabaseConnectivityError } from "../lib/search-index/connectivity-hints";
import { syncSraNamesToTypesense } from "../lib/search-index/sync-sra-names-typesense";
import { backfillSraOrganisationDisplayNames } from "../lib/sra/backfill-display-names";
import {
  buildTypesenseListingsClientFromEnv,
  typesenseTlsErrorHint,
} from "../lib/search/typesense-listings-client";
import { resolveTypesenseNodeConfig } from "../lib/search-index/connectivity-hints";

function parseArg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=")[1];
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1]!.startsWith("--")) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function assertDatabaseReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.error(formatDatabaseConnectivityError(e));
    process.exit(1);
  }
}

async function main() {
  const limitRaw = parseArg("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const resumeAfter = parseArg("resume-after");
  const debug = process.argv.includes("--debug");
  const withBackfill = process.argv.includes("--with-backfill");
  const skipBackfill = process.argv.includes("--skip-backfill") || !withBackfill;
  const skipTypesense = process.argv.includes("--skip-typesense");
  const forceDocumentUpdate = process.argv.includes("--force-document-update");

  if (limitRaw && (!Number.isFinite(limit) || limit! <= 0)) {
    console.error("--limit must be a positive number");
    process.exit(1);
  }

  await assertDatabaseReachable();

  if (!skipBackfill) {
    const backfill = await backfillSraOrganisationDisplayNames(prisma);
    console.log(
      JSON.stringify({ event: "sra_names_backfill", scanned: backfill.scanned, updated: backfill.updated }),
    );
  }

  const node = resolveTypesenseNodeConfig();
  if (debug && node) {
    console.info(JSON.stringify({ event: "typesense_node_config", ...node }));
  }

  const client = buildTypesenseListingsClientFromEnv({ connectionTimeoutSeconds: 30 });
  if (!client && !skipTypesense) {
    console.error("Typesense client not configured (TYPESENSE_HOST / TYPESENSE_API_KEY)");
    process.exit(1);
  }

  if (client && !skipTypesense) {
    try {
      await client.health.retrieve();
    } catch (e) {
      const hint = typesenseTlsErrorHint(e);
      console.error(hint ?? (e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  }

  const stats = await syncSraNamesToTypesense(prisma, client!, {
    limit,
    resumeAfter,
    debug,
    skipTypesense,
    forceDocumentUpdate,
  });

  console.log(
    JSON.stringify({
      event: "sra_names_index",
      collection: stats.collection,
      orgsLoaded: stats.orgsLoaded,
      patchesBuilt: stats.patchesBuilt,
      titleReasons: stats.titleReasons,
      typesense: stats.typesense,
    }),
  );

  if (stats.degraded) {
    console.error(
      JSON.stringify({
        event: "search_index_sra_degraded",
        degraded: true,
        resumeAfter: stats.resumeAfter ?? null,
      }),
    );
    process.exit(1);
  }

  const errors = stats.typesense?.errors ?? [];
  if (errors.length) {
    console.error("Errors:", errors.slice(0, 20));
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(formatDatabaseConnectivityError(e));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
