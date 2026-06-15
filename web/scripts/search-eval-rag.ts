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
import { SEARCH_EVAL_CASES } from "../lib/search-eval/cases";
import {
  formatConsoleSummary,
  writeSearchEvalReports,
} from "../lib/search-eval/reporters";

async function runBehaviouralSignalDegradationEval(): Promise<void> {
  const prev = process.env.SEARCH_SIGNALS_FORCE_UNAVAILABLE;
  try {
    process.env.SEARCH_SIGNALS_FORCE_UNAVAILABLE = "1";
    const oneCase = SEARCH_EVAL_CASES.find(
      (c) => c.channel === "directory" && c.id === "dir-employment-topical-gate-01",
    );
    if (!oneCase) return;
    const report = await runSearchEval({ cases: [oneCase], skipMatcher: true });
    const r = report.results[0];
    if (!r || !r.resultCount) {
      throw new Error("degradation eval expected non-empty directory results");
    }
    console.log("PASS behavioural signals graceful degradation eval");
  } finally {
    if (prev == null) delete process.env.SEARCH_SIGNALS_FORCE_UNAVAILABLE;
    else process.env.SEARCH_SIGNALS_FORCE_UNAVAILABLE = prev;
  }
}

async function main() {
  const skipMatcher = !process.env.DATABASE_URL?.trim();
  if (skipMatcher) {
    console.warn("WARN: DATABASE_URL unset — skipping matcher channel cases");
  }

  const report = await runSearchEval({ skipMatcher });
  console.log(formatConsoleSummary(report));
  await runBehaviouralSignalDegradationEval();

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
