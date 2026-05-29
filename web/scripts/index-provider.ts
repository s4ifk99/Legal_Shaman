/**
 * Incremental Typesense upsert for one provider.
 * Usage:
 *   npm run index:provider -- --id=sra:921469 --source=sra
 *   npm run index:provider -- --id=curated:hackney-law-centre --source=curated
 */
import "./load-dotenv";
import { requireOpsEnvironment } from "../lib/ops/environment-guard";
import { normaliseEntitySource } from "../lib/ops/indexing-jobs";
import { indexSingleProvider } from "../lib/ops/incremental-index";

function parseArgs(argv: string[]): { id: string; source: string } | null {
  let id = "";
  let source = "";
  for (const arg of argv) {
    if (arg.startsWith("--id=")) id = arg.slice(5).trim();
    if (arg.startsWith("--source=")) source = arg.slice(9).trim();
  }
  if (!id) return null;
  return { id, source };
}

async function main() {
  requireOpsEnvironment(process.argv);
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed?.id) {
    console.error("Usage: npm run index:provider -- --id=<entityId> [--source=sra|legal_aid|probono|curated|lawyers]");
    process.exit(1);
  }

  const inferred = normaliseEntitySource(parsed.source) ?? normaliseEntitySource(
    parsed.id.startsWith("sra:")
      ? "sra"
      : parsed.id.startsWith("legal_aid:")
        ? "legal_aid"
        : parsed.id.startsWith("probono:")
          ? "probono"
          : parsed.id.startsWith("lawyer:")
            ? "lawyers"
            : "curated",
  );

  if (!inferred) {
    console.error("Invalid --source; use sra, legal_aid, probono, curated, or lawyers");
    process.exit(1);
  }

  const result = await indexSingleProvider(parsed.id, inferred);
  console.info(JSON.stringify({ event: "index_provider", ...result }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
