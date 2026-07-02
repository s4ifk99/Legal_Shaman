/**
 * Backfill pgvector embeddings for legal_chunks (no wiki re-import).
 * Loops until all chunks are embedded or --max-batches is reached.
 *
 *   npm run legal-knowledge:embed-backfill
 *   npm run legal-knowledge:embed-backfill -- --max-batches=3
 */
import "./load-dotenv";

import Module from "node:module";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

function parseIntFlag(argv: string[], name: string): number | null {
  const arg = argv.find((a) => a.startsWith(`${name}=`));
  if (!arg) return null;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const maxBatches = parseIntFlag(argv, "--max-batches");

  const { embedLegalChunks, countEmbeddedChunks } = await import(
    "../lib/legal-knowledge/embed-chunks"
  );
  const { createPrismaClient } = await import("../lib/db/prisma");
  const prisma = createPrismaClient();

  try {
    const pendingRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM legal_chunks WHERE embedding IS NULL
    `;
    const pendingStart = Number(pendingRows[0]?.count ?? 0);
    console.info(
      JSON.stringify({ event: "legal_embed_backfill_start", pending: pendingStart }),
    );

    let batch = 0;
    let totalUpdated = 0;

    while (true) {
      batch += 1;
      if (maxBatches != null && batch > maxBatches) break;

      const updated = await embedLegalChunks();
      totalUpdated += updated;
      const embedded = await countEmbeddedChunks();
      console.info(
        JSON.stringify({
          event: "legal_embed_backfill_batch",
          batch,
          updated,
          embedded,
          pending: Math.max(0, pendingStart - totalUpdated),
        }),
      );

      if (updated === 0) break;
    }

    const embeddedFinal = await countEmbeddedChunks();
    const pendingFinal = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM legal_chunks WHERE embedding IS NULL
    `;

    console.info(
      JSON.stringify({
        event: "legal_embed_backfill_complete",
        batches: batch,
        totalUpdated,
        embedded: embeddedFinal,
        pending: Number(pendingFinal[0]?.count ?? 0),
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
