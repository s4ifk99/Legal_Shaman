/**
 * LegalBench-RAG-style retrieval evaluation (live search stack).
 * Run: cd web && npm run search:eval:rag
 */
import "./load-dotenv";

import Module from "node:module";
import path from "node:path";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

import { runSearchEval } from "../lib/search-eval/runner";
import {
  formatConsoleSummary,
  writeSearchEvalReports,
} from "../lib/search-eval/reporters";

async function main() {
  const skipMatcher = !process.env.DATABASE_URL?.trim();
  if (skipMatcher) {
    console.warn("WARN: DATABASE_URL unset — skipping matcher channel cases");
  }

  const report = await runSearchEval({ skipMatcher });
  console.log(formatConsoleSummary(report));

  const reportsDir = path.join(process.cwd(), "reports");
  const { jsonPath, mdPath } = await writeSearchEvalReports(report, reportsDir);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);

  if (!report.aggregate.passCriteriaMet) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
