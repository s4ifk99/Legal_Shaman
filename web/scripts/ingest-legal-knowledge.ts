/**
 * Ingest curated UK legal knowledge into Postgres + pgvector.
 *
 * Usage:
 *   npm run ingest:legal-knowledge
 *   npm run ingest:legal-knowledge -- --skip-embeddings
 *   npm run ingest:legal-knowledge -- --limit=50
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

function parseFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseIntFlag(argv: string[], name: string): number | null {
  const arg = argv.find((a) => a.startsWith(`${name}=`));
  if (!arg) return null;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const { createPrismaClient } = await import("../lib/db/prisma");
  const { embedLegalChunks } = await import("../lib/legal-knowledge/embed-chunks");
  const { ensureWikiSource, seedLegalSources } = await import("../lib/ingestion/seed-sources");
  const { importWikiMarkdown } = await import("../lib/ingestion/wiki-import");

  const argv = process.argv.slice(2);
  const skipEmbeddings = parseFlag(argv, "--skip-embeddings");
  const limit = parseIntFlag(argv, "--limit");

  const prisma = createPrismaClient();

  const run = await prisma.ingestionRun.create({
    data: { sourceType: "wiki_markdown", status: "running" },
  });

  console.info(
    JSON.stringify({ event: "legal_knowledge_ingest_start", runId: run.id, skipEmbeddings, limit }),
  );

  try {
    const sourcesSeeded = await seedLegalSources(prisma);
    const wikiSourceId = await ensureWikiSource(prisma);
    const imported = await importWikiMarkdown(prisma, wikiSourceId, {
      limit: limit ?? undefined,
    });

    let embeddingsCreated = 0;
    if (!skipEmbeddings) {
      embeddingsCreated = await embedLegalChunks();
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        documentsProcessed: imported.documentsProcessed,
        chunksCreated: imported.chunksCreated,
        embeddingsCreated,
        errorCount: imported.errors.length,
        errors: imported.errors.length ? imported.errors.slice(0, 50) : undefined,
        completedAt: new Date(),
      },
    });

    console.info(
      JSON.stringify({
        event: "legal_knowledge_ingest_complete",
        runId: run.id,
        sourcesSeeded,
        documentsProcessed: imported.documentsProcessed,
        chunksCreated: imported.chunksCreated,
        embeddingsCreated,
        errors: imported.errors.length,
      }),
    );

    if (imported.errors.length) {
      console.warn("Sample errors:", imported.errors.slice(0, 5));
    }
  } catch (err) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorCount: 1,
        errors: [err instanceof Error ? err.message : String(err)],
        completedAt: new Date(),
      },
    });
    console.error(err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
