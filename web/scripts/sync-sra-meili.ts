/**
 * SRA v2 sync — fetch GetAll, persist structured register fields + raw JSON,
 * checkpoint every 500 records, optional resume/offset/limit.
 *
 * Loads `web/.env` then `web/.env.local` (override).
 *
 * Env:
 *   SRA_APIM_SUBSCRIPTION_KEY (required)
 *   DATABASE_URL (required for Postgres sync)
 *   MEILISEARCH_HOST, MEILISEARCH_API_KEY (optional)
 *   TYPESENSE_HOST, TYPESENSE_API_KEY (for post-sync index update)
 *
 * Flags:
 *   --limit=N           Process only N organisations (after resume/offset)
 *   --offset=N          Skip first N rows in the sorted queue
 *   --resume            Continue after last successful SraNumber in checkpoint
 *   --checkpoint        Enable checkpoint writes every 500 (default: on)
 *   --no-checkpoint     Disable checkpoint file writes
 *   --skip-embeddings   Skip embedding during sync
 *   --skip-typesense    Skip Typesense update after sync
 *   --skip-purge        Skip archiving rows not in latest GetAll
 *
 * Examples:
 *   npm run sra:sync -- --limit=1000 --skip-embeddings
 *   npm run sra:sync -- --resume --skip-embeddings
 *   npm run sra:sync -- --offset=5000 --limit=1000 --checkpoint
 */

import "./load-dotenv";
import { createPrismaClient } from "../lib/db/prisma";
import { runSraV2Sync } from "../lib/sra/sra-sync-v2";

function parsePositiveIntFlag(argv: string[], name: string): number | null {
  const arg = argv.find((a) => a.startsWith(`${name}=`));
  if (!arg) return null;
  const n = Number(arg.split("=")[1]);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`Invalid ${name} value: ${arg.split("=")[1]}`);
    process.exit(1);
  }
  return Math.floor(n);
}

async function main() {
  const argv = process.argv;
  const sraKey = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
  const host = process.env.MEILISEARCH_HOST?.trim();
  const meiliKey = process.env.MEILISEARCH_API_KEY?.trim() ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!sraKey) {
    console.error("Missing SRA_APIM_SUBSCRIPTION_KEY");
    process.exit(1);
  }
  if (!databaseUrl) {
    console.error("DATABASE_URL required for SRA v2 sync.");
    process.exit(1);
  }

  const limit = parsePositiveIntFlag(argv, "--limit");
  const offset = parsePositiveIntFlag(argv, "--offset");
  const resume = argv.includes("--resume");
  const checkpoint = !argv.includes("--no-checkpoint");
  const skipEmbeddings = argv.includes("--skip-embeddings");
  const skipTypesense = argv.includes("--skip-typesense");
  const skipPurge = argv.includes("--skip-purge");
  const meiliEnabled = Boolean(host);

  if (resume) console.log("--resume: will continue from checkpoint if present.");
  if (offset != null) console.log(`--offset=${offset}`);
  if (limit != null) console.log(`--limit=${limit}`);
  if (checkpoint) console.log("Checkpoints enabled (every 500 records).");

  const prisma = createPrismaClient();
  try {
    const result = await runSraV2Sync(prisma, sraKey, {
      limit,
      offset,
      resume,
      checkpoint,
      skipEmbeddings,
      skipTypesense,
      skipPurge,
      meiliEnabled,
      meiliHost: host,
      meiliKey,
      skipLinkFirms: limit != null,
    });

    console.log("\n=== SRA v2 sync summary ===");
    console.log(
      JSON.stringify(
        {
          fetched: result.fetched,
          processed: result.processed,
          failed: result.failed,
          completed: result.completed,
          typesenseUpserted: result.typesenseUpserted,
          purged: result.purged,
        },
        null,
        2,
      ),
    );

    if (result.failed > 0) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
