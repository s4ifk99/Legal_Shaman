/**
 * Multi-turn triage journey evaluation (live search stack).
 * Run: cd web && npm run search:eval:journeys
 */
import "./load-dotenv";

import Module from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

async function main() {
  process.env.EXTERNAL_FALLBACK_SKIP_HEAD = "1";

  const { runTriageSearch } = await import("../lib/legal-search/triage/run-triage-search");
  const { formatJourneyConsoleSummary, runTriageJourneyEval } = await import(
    "../lib/search-eval/triage-journey-runner"
  );

  const report = await runTriageJourneyEval(runTriageSearch);
  console.log(formatJourneyConsoleSummary(report));

  for (const r of report.results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(
      `  ${status} ${r.caseId} (${r.turns.length} turns, internal=${r.turns.at(-1)?.internalResultCount ?? 0})`,
    );
  }

  const reportsDir = path.join(process.cwd(), "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, "search-eval-journeys.json");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nWrote ${jsonPath}`);

  if (report.failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
