/**
 * Cursor-style Ask the Shaman eval.
 *
 * Scores local answers against gold references for tone, structure, keywords, and sources.
 *
 *   npm run eval:cursor-style
 *   npm run eval:cursor-style -- --min=0.65
 */
import "./load-dotenv";

import Module from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  cursorStyleScore,
  groundingOverlap,
  type CursorGoldCase,
} from "../lib/eval/cursor-style-similarity";

const nodeModule = Module as typeof Module & { _load: Function };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

const MIN = Number(process.argv.find((a) => a.startsWith("--min="))?.slice(6) ?? 0.6);
const GOLD_PATH = path.join(process.cwd(), "data/cursor-style-gold.json");
const REPORT_JSON = path.join(process.cwd(), "reports/cursor-style-eval.json");
const REPORT_MD = path.join(process.cwd(), "reports/cursor-style-eval.md");

type GoldFile = { cases?: CursorGoldCase[] };

function loadCases(): CursorGoldCase[] {
  if (!existsSync(GOLD_PATH)) throw new Error(`Missing ${GOLD_PATH}`);
  const raw = JSON.parse(readFileSync(GOLD_PATH, "utf8")) as GoldFile;
  return raw.cases ?? [];
}

async function evaluateOne(gold: CursorGoldCase) {
  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
  const result = await runLegalKnowledgeSearch({ query: gold.query, includeDirectory: false });
  const answer = (result.answer ?? "").trim();
  const titles = result.sources.map((s) => s.title);
  const scores = cursorStyleScore({ answer, sourceTitles: titles, gold });
  const grounding = groundingOverlap(answer, gold);
  return {
    id: gold.id,
    title: gold.title,
    answerMode: result.answerMode,
    debugMode: result.debug?.mode,
    topSources: titles.slice(0, 4),
    preview: answer.slice(0, 280),
    grounding: Number(grounding.toFixed(3)),
    ...scores,
    pass: scores.combined >= MIN && grounding >= 0.15,
  };
}

async function main() {
  const cases = loadCases();
  console.log(JSON.stringify({ event: "cursor_style_eval_start", cases: cases.length, min: MIN }));

  const results = [];
  for (const c of cases) {
    const row = await evaluateOne(c);
    results.push(row);
    console.log(JSON.stringify({ event: "cursor_style_case", id: row.id, combined: row.combined, pass: row.pass }));
  }

  const avg = results.reduce((s, r) => s + r.combined, 0) / results.length;
  const passed = results.filter((r) => r.pass).length;

  mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  writeFileSync(
    REPORT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        min: MIN,
        avg,
        passed,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );

  const fails = results.filter((r) => !r.pass);
  writeFileSync(
    REPORT_MD,
    [
      `# Cursor-style Ask the Shaman eval`,
      ``,
      `- Average combined score: **${avg.toFixed(3)}** (target ${MIN})`,
      `- Passed: ${passed}/${results.length}`,
      ``,
      `## Failures (${fails.length})`,
      ...fails.map(
        (f) =>
          `- **${f.id}** combined=${f.combined} tone=${f.toneSim} sections=${f.sectionSim} keywords=${f.keywordSim}\n  - ${f.preview}`,
      ),
    ].join("\n"),
  );

  console.log(
    JSON.stringify({
      event: "cursor_style_eval_done",
      ok: avg >= MIN,
      avg: Number(avg.toFixed(3)),
      passed,
      total: results.length,
      reportJson: REPORT_JSON,
    }),
  );

  process.exit(avg >= MIN ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
