/**
 * Satnav multi-route eval — asserts chosen route ids and primary source titles.
 *
 *   npm run eval:satnav-routes
 */
import "./load-dotenv";

import Module from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const nodeModule = Module as typeof Module & { _load: Function };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

const GOLD_PATH = path.join(process.cwd(), "data/satnav-route-gold.json");
const REPORT_JSON = path.join(process.cwd(), "reports/satnav-route-eval.json");
const REPORT_MD = path.join(process.cwd(), "reports/satnav-route-eval.md");

type GoldCase = {
  id: string;
  title: string;
  query: string;
  mustChooseRouteIdIncludes?: string[];
  mustNotChooseRouteIdIncludes?: string[];
  primarySourceTitleIncludesAny?: string[];
  mustNotPrimarySourceTitleIncludesAny?: string[];
  allowMix?: boolean;
};

type GoldFile = { cases?: GoldCase[] };

function loadCases(): GoldCase[] {
  if (!existsSync(GOLD_PATH)) throw new Error(`Missing ${GOLD_PATH}`);
  const raw = JSON.parse(readFileSync(GOLD_PATH, "utf8")) as GoldFile;
  return raw.cases ?? [];
}

function includesAny(hay: string, needles: string[]): boolean {
  const lower = hay.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

function routeIdMatches(chosen: string[], needles: string[]): boolean {
  return needles.some((n) => chosen.some((id) => id.toLowerCase().includes(n.toLowerCase())));
}

async function evaluateOne(gold: GoldCase) {
  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
  const result = await runLegalKnowledgeSearch({
    query: gold.query,
    includeDirectory: false,
  });

  const chosen = result.debug?.chosenRouteIds ?? [];
  const decision = result.debug?.routeDecision;
  const primaryTitle = result.sources[0]?.title ?? "";
  const routes = result.debug?.routesConsidered ?? [];

  const failures: string[] = [];

  if (gold.mustChooseRouteIdIncludes?.length) {
    if (!routeIdMatches(chosen, gold.mustChooseRouteIdIncludes)) {
      failures.push(
        `chosen routes [${chosen.join(", ")}] missing any of [${gold.mustChooseRouteIdIncludes.join(", ")}]`,
      );
    }
  }

  if (gold.mustNotChooseRouteIdIncludes?.length) {
    if (routeIdMatches(chosen, gold.mustNotChooseRouteIdIncludes)) {
      failures.push(
        `chosen routes [${chosen.join(", ")}] must not include [${gold.mustNotChooseRouteIdIncludes.join(", ")}]`,
      );
    }
  }

  if (gold.primarySourceTitleIncludesAny?.length && primaryTitle) {
    if (!includesAny(primaryTitle, gold.primarySourceTitleIncludesAny)) {
      failures.push(
        `primary source “${primaryTitle}” missing any of [${gold.primarySourceTitleIncludesAny.join(", ")}]`,
      );
    }
  } else if (gold.primarySourceTitleIncludesAny?.length && !primaryTitle) {
    failures.push("no primary source title");
  }

  if (gold.mustNotPrimarySourceTitleIncludesAny?.length && primaryTitle) {
    if (includesAny(primaryTitle, gold.mustNotPrimarySourceTitleIncludesAny)) {
      failures.push(`primary source “${primaryTitle}” matched forbidden title tokens`);
    }
  }

  if (gold.allowMix === false && decision === "mix") {
    failures.push("expected pick but got mix");
  }

  return {
    id: gold.id,
    title: gold.title,
    pass: failures.length === 0,
    failures,
    decision,
    chosenRouteIds: chosen,
    routeRationale: result.debug?.routeRationale,
    routesConsidered: routes.map((r) => ({
      id: r.id,
      score: r.score,
      topTitle: r.topTitle,
    })),
    primarySource: primaryTitle,
    answerMode: result.answerMode,
    debugMode: result.debug?.mode,
    searchRouteMode: result.debug?.searchRouteMode,
    preview: (result.answer ?? "").slice(0, 220),
  };
}

async function main() {
  process.env.SEARCH_ROUTE_MODE = process.env.SEARCH_ROUTE_MODE || "satnav";
  const cases = loadCases();
  console.log(
    JSON.stringify({
      event: "satnav_route_eval_start",
      cases: cases.length,
      mode: process.env.SEARCH_ROUTE_MODE,
    }),
  );

  const results = [];
  for (const c of cases) {
    const row = await evaluateOne(c);
    results.push(row);
    console.log(
      JSON.stringify({
        event: "satnav_route_case",
        id: row.id,
        pass: row.pass,
        chosen: row.chosenRouteIds,
        primary: row.primarySource,
        failures: row.failures,
      }),
    );
  }

  const passed = results.filter((r) => r.pass).length;
  mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  writeFileSync(
    REPORT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        passed,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );

  const md = [
    `# Satnav route eval`,
    ``,
    `Passed **${passed}/${results.length}**`,
    ``,
    ...results.map(
      (r) =>
        `## ${r.id} ${r.pass ? "PASS" : "FAIL"}\n\n- chosen: ${r.chosenRouteIds.join(", ") || "(none)"}\n- decision: ${r.decision}\n- primary: ${r.primarySource || "(none)"}\n${r.failures.length ? `- failures: ${r.failures.join("; ")}\n` : ""}`,
    ),
  ].join("\n");
  writeFileSync(REPORT_MD, md);

  console.log(JSON.stringify({ event: "satnav_route_eval_done", passed, total: results.length }));
  if (passed < results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
