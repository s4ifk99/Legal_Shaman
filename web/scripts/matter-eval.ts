#!/usr/bin/env tsx
/**
 * Matter Engine eval — run baseline then matter-scoped retrieval for comparison.
 *
 *   npm run matter:eval
 *   npm run matter:eval -- --mode=baseline
 *   npm run matter:eval -- --mode=matter-scoped
 *   npm run matter:eval -- --compare
 *   npm run matter:eval -- --suite=regression
 *   npm run matter:eval -- --compare --suite=adversarial
 */
import { formatMatterEvalReport, runMatterEval } from "../lib/matter/eval/run";
import type { MatterEvalSuite } from "../lib/matter/eval/types";

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1];
const suiteArg = args.find((a) => a.startsWith("--suite="))?.split("=")[1] as
  | MatterEvalSuite
  | undefined;
const compare = args.includes("--compare");
const suite =
  suiteArg === "regression" || suiteArg === "coverage" || suiteArg === "adversarial"
    ? suiteArg
    : undefined;

function printReport(label: string, mode: "baseline" | "matter-scoped") {
  console.log(`\n${"=".repeat(60)}\n${label}\n${"=".repeat(60)}\n`);
  console.log(formatMatterEvalReport(runMatterEval(mode, { suite })));
}

if (compare || !modeArg) {
  printReport("BASELINE (submission-driven retrieval)", "baseline");
  printReport("MATTER-SCOPED (MatterFrame intents)", "matter-scoped");
  process.exit(0);
}

const mode = modeArg === "matter-scoped" ? "matter-scoped" : "baseline";
printReport(`MODE: ${mode}`, mode);
