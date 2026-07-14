/**
 * Integrate a raw source into the consumer Areas/ wiki knowledge graph.
 *
 * Usage:
 *   npm run knowledge:integrate -- --file=path/to/source.md
 *   npm run knowledge:integrate -- --url=https://www.gov.uk/...
 *   npm run knowledge:integrate -- --file=... --dry-run
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

async function main() {
  const argv = process.argv.slice(2);
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const urlArg = argv.find((a) => a.startsWith("--url="));
  const dryRun = argv.includes("--dry-run");

  const { createPrismaClient } = await import("../lib/db/prisma");
  const { integrateSource, integrateSourceFromFile } = await import(
    "../lib/knowledge-compiler/integrate-source"
  );

  const prisma = createPrismaClient();

  let result;
  if (fileArg) {
    const path = fileArg.split("=").slice(1).join("=");
    result = await integrateSourceFromFile(path, { dryRun });
  } else if (urlArg) {
    const url = urlArg.split("=").slice(1).join("=");
    const res = await fetch(url);
    const rawText = await res.text();
    result = await integrateSource({ rawText, sourceUrl: url, sourceType: "url", dryRun });
  } else {
    console.error("Provide --file= or --url=");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  console.info(JSON.stringify({ event: "knowledge_integrate", ...result }));
  await prisma.$disconnect();
  if (result.blocked || result.errors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
