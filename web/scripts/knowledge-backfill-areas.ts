/**
 * Backfill knowledge concept graph from Areas/ wiki index.
 *
 * Usage: npm run knowledge:backfill-areas
 *        npm run knowledge:backfill-areas -- --limit=100
 */
import "./load-dotenv";

function logEvent(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

logEvent({ event: "knowledge_backfill_boot" });

import Module from "node:module";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

function parseLimit(argv: string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith("--limit="));
  if (!arg) return undefined;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) ? n : undefined;
}

async function main() {
  const { createPrismaClient } = await import("../lib/db/prisma");
  const { backfillConceptGraphFromWikiIndex } = await import(
    "../lib/knowledge-compiler/concept-graph"
  );
  const { embedConceptSummaries } = await import("../lib/knowledge-compiler/embed-concepts");

  const prisma = createPrismaClient();
  const limit = parseLimit(process.argv.slice(2));

  logEvent({
    event: "knowledge_backfill_start",
    limit: limit ?? "all",
    message:
      "Progress logs every 10 pages. Resumes pages that already have claims. Expect ~1–2 hours for full run.",
  });

  const result = await backfillConceptGraphFromWikiIndex({
    limit,
    onProgress: ({ phase, done, total, conceptsUpserted, claimsCreated, edgesCreated }) => {
      logEvent({
        event: "knowledge_backfill_progress",
        phase,
        done,
        total,
        pct: Math.round((done / total) * 100),
        conceptsUpserted,
        claimsCreated,
        edgesCreated,
      });
    },
  });
  logEvent({ event: "knowledge_backfill", ...result });

  logEvent({ event: "knowledge_embed_start", limit: limit ?? 500 });
  const embedded = await embedConceptSummaries(limit ?? 500);
  logEvent({ event: "knowledge_embed_concepts", embedded });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
