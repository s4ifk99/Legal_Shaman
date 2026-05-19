/**
 * Backfill embeddings for `sra_organisations` rows.
 *
 * Usage:
 *   cd web && npm run sra:embed
 *   cd web && npm run sra:embed -- --all
 *
 * Default: embeds only rows where `embedding IS NULL` (resumable).
 * Pass `--all` to re-embed every row (e.g. after model changes).
 *
 * Loads `.env` then `.env.local` like the other scripts.
 */

import "./load-dotenv";
import {
  countSraOrgsMissingEmbedding,
  embedAllSraOrgs,
  embedSraOrgsMissing,
} from "../lib/sra/embed";
import { prisma } from "../lib/db/prisma";

async function main() {
  if (!process.env.LLM_API_KEY?.trim()) {
    console.error("LLM_API_KEY not set — cannot generate embeddings.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL not set — cannot connect to Postgres.");
    process.exit(1);
  }

  const all = process.argv.includes("--all");
  const missing = await countSraOrgsMissingEmbedding();
  console.log(
    all
      ? "Re-embedding ALL sra_organisations rows."
      : `Embedding only rows missing an embedding (currently ${missing}).`,
  );

  const updated = all ? await embedAllSraOrgs() : await embedSraOrgsMissing(1_000_000);
  console.log(`Done. Embedded ${updated} rows.`);
}

void main()
  .catch((err) => {
    console.error("[sra:embed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
