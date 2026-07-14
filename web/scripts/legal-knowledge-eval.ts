/**
 * Evaluation harness for legal knowledge search (layered tiers).
 *
 * Usage:
 *   npm run legal-search:eval:unit
 *   npm run legal-search:eval:retrieval
 *   npm run legal-search:eval
 *   npm run legal-search:eval -- --query="unfair dismissal"
 *   npm run legal-search:eval:generate
 */
import "./load-dotenv";

import Module from "node:module";
import path from "node:path";

import type { LegalKnowledgeEvalTier } from "../lib/legal-knowledge/eval/types";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

function parseTierArg(argv: string[]): LegalKnowledgeEvalTier | "all" {
  const args = argv.filter((a) => a.startsWith("--tier="));
  const arg = args[args.length - 1];
  if (!arg) return "all";
  const value = arg.split("=").slice(1).join("=").trim();
  if (
    value === "unit" ||
    value === "retrieval" ||
    value === "integration" ||
    value === "compiler"
  ) {
    return value;
  }
  return "all";
}

function parseQueryArg(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--query="));
  return arg ? arg.split("=").slice(1).join("=").trim() : null;
}

function parseGenerateArg(argv: string[]): boolean {
  return argv.includes("--generate") || argv.includes("generate");
}

async function main() {
  const argv = process.argv.slice(2);

  if (parseGenerateArg(argv)) {
    const { printGeneratedCases } = await import("../lib/legal-knowledge/eval/generate-cases");
    printGeneratedCases();
    return;
  }

  const tier = parseTierArg(argv);
  const customQuery = parseQueryArg(argv);

  if (tier === "retrieval" || tier === "all") {
    const { isKnowledgeGraphDbReady } = await import("../lib/knowledge-compiler/db-ready");
    const graphReady = await isKnowledgeGraphDbReady();
    if (!graphReady) {
      console.warn(
        "Knowledge graph tables not ready. Run: npm run db:migrate && npm run knowledge:backfill-areas",
      );
    }
  }

  const { runLegalKnowledgeEval } = await import("../lib/legal-knowledge/eval/runner");
  const { formatConsoleSummary, writeLegalKnowledgeEvalReports } = await import(
    "../lib/legal-knowledge/eval/reporters"
  );

  const report = await runLegalKnowledgeEval({ tier, customQuery: customQuery ?? undefined });
  const reportsDir = path.join(process.cwd(), "reports");

  console.info(formatConsoleSummary(report));

  for (const result of report.results) {
    console.info(
      JSON.stringify({
        event: "legal_knowledge_eval",
        id: result.caseId,
        tier: result.tier,
        query: result.query,
        pass: result.passed,
        failures: result.failures,
        taxonomySlug: result.taxonomySlug,
        sourcePrecisionAt3: result.sourcePrecisionAt3,
        directoryPrecisionAtK: result.directoryPrecisionAtK,
      }),
    );
  }

  const { jsonPath, mdPath } = await writeLegalKnowledgeEvalReports(report, reportsDir);
  console.info(JSON.stringify({ event: "legal_knowledge_eval_reports", jsonPath, mdPath }));

  console.info(
    JSON.stringify({
      event: "legal_knowledge_eval_summary",
      tier: report.tier,
      passed: report.aggregate.passedCount,
      total: report.aggregate.caseCount,
      passCriteriaMet: report.aggregate.passCriteriaMet,
    }),
  );

  if (!report.aggregate.passCriteriaMet || report.aggregate.failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
