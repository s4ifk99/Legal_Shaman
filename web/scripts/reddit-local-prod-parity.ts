/**
 * Reddit local vs production Ask-the-Shaman parity.
 *
 * Compares local runLegalKnowledgeSearch (gold) with production /api/legal-search.
 * Target: average combined similarity >= 0.90
 *
 *   npm run parity:reddit
 *   npm run parity:reddit -- --limit=20
 *   npm run parity:reddit -- --url=https://www.legalshaman.com --min=0.9
 */
import "./load-dotenv";

import Module from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { combinedParityScore } from "../lib/eval/answer-similarity";

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const nodeModule = Module as typeof Module & { _load: NodeLoad };
const load = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return load(request, parent, isMain);
};

const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 25);
const MIN = Number(process.argv.find((a) => a.startsWith("--min="))?.slice(6) ?? 0.9);
const PROD_URL =
  process.argv.find((a) => a.startsWith("--url="))?.slice(6)?.replace(/\/$/, "") ??
  "https://www.legalshaman.com";
const QUESTIONS_PATH = path.join(process.cwd(), "data/reddit-eval-100.json");
const REPORT_JSON = path.join(process.cwd(), "reports/reddit-local-prod-parity.json");
const REPORT_MD = path.join(process.cwd(), "reports/reddit-local-prod-parity.md");

type RedditQuestion = {
  id: string;
  title: string;
  query: string;
  subreddit?: string;
  url?: string;
};

type CaseResult = {
  id: string;
  title: string;
  similarity: number;
  answerSim: number;
  sourceSim: number;
  modeMatch: boolean;
  localMode?: string;
  prodMode?: string;
  localDebugMode?: string;
  prodDebugMode?: string;
  localSources: string[];
  prodSources: string[];
  localPreview: string;
  prodPreview: string;
  prodHttp?: number;
  prodMs?: number;
  pass: boolean;
  error?: string;
};

function loadQuestions(): RedditQuestion[] {
  if (!existsSync(QUESTIONS_PATH)) {
    throw new Error(`Missing ${QUESTIONS_PATH} — run npm run reddit:shaman:eval -- --skip-fetch`);
  }
  const raw = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8")) as {
    questions?: RedditQuestion[];
  };
  return (raw.questions ?? []).slice(0, LIMIT);
}

async function fetchProd(query: string): Promise<{
  answer: string;
  sources: string[];
  answerMode?: string;
  debugMode?: string;
  http: number;
  ms: number;
  error?: string;
}> {
  const url = `${PROD_URL}/api/legal-search`;
  const cookie = process.env.SMOKE_SESSION_COOKIE?.trim();
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ query, includeDirectory: false }),
      signal: AbortSignal.timeout(120_000),
    });
    const ms = Date.now() - t0;
    const raw = await res.text();
    let body: {
      answer?: string | null;
      sources?: Array<{ title?: string }>;
      answerMode?: string;
      debug?: { mode?: string };
      error?: string;
    } = {};
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return {
        answer: "",
        sources: [],
        http: res.status,
        ms,
        error: `non_json:${raw.slice(0, 80)}`,
      };
    }
    return {
      answer: (body.answer ?? "").trim(),
      sources: (body.sources ?? []).map((s) => s.title ?? "").filter(Boolean),
      answerMode: body.answerMode,
      debugMode: body.debug?.mode,
      http: res.status,
      ms,
      error: res.ok ? undefined : body.error,
    };
  } catch (err) {
    return {
      answer: "",
      sources: [],
      http: 0,
      ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runLocal(query: string): Promise<{
  answer: string;
  sources: string[];
  answerMode?: string;
  debugMode?: string;
  error?: string;
}> {
  try {
    const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");
    const result = await runLegalKnowledgeSearch({ query, includeDirectory: false });
    return {
      answer: (result.answer ?? "").trim(),
      sources: result.sources.map((s) => s.title),
      answerMode: result.answerMode,
      debugMode: result.debug?.mode,
    };
  } catch (err) {
    return {
      answer: "",
      sources: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function evaluateOne(q: RedditQuestion): Promise<CaseResult> {
  const local = await runLocal(q.query);
  const prod = await fetchProd(q.query);

  const { similarity, answerSim, sourceSim, modeMatch } = combinedParityScore({
    localAnswer: local.answer,
    prodAnswer: prod.answer,
    localTitles: local.sources,
    prodTitles: prod.sources,
    localMode: local.answerMode,
    prodMode: prod.answerMode,
  });

  const pass = similarity >= MIN && !local.error && !prod.error && prod.http === 200;

  return {
    id: q.id,
    title: q.title,
    similarity: Number(similarity.toFixed(3)),
    answerSim: Number(answerSim.toFixed(3)),
    sourceSim: Number(sourceSim.toFixed(3)),
    modeMatch,
    localMode: local.answerMode,
    prodMode: prod.answerMode,
    localDebugMode: local.debugMode,
    prodDebugMode: prod.debugMode,
    localSources: local.sources.slice(0, 5),
    prodSources: prod.sources.slice(0, 5),
    localPreview: local.answer.slice(0, 180),
    prodPreview: prod.answer.slice(0, 180),
    prodHttp: prod.http,
    prodMs: prod.ms,
    pass,
    error: local.error ?? prod.error,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
      console.log(JSON.stringify({ event: "parity_case_done", index: i + 1, total: items.length }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

function writeReports(results: CaseResult[], avg: number) {
  mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  writeFileSync(
    REPORT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        prodUrl: PROD_URL,
        limit: LIMIT,
        min: MIN,
        avg,
        passed: results.filter((r) => r.pass).length,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );

  const fails = results.filter((r) => !r.pass);
  const md = [
    `# Reddit local vs production parity`,
    ``,
    `- Generated: ${new Date().toISOString()}`,
    `- Production: ${PROD_URL}`,
    `- Cases: ${results.length}`,
    `- Average similarity: **${avg.toFixed(3)}** (target ${MIN})`,
    `- Passed: ${results.filter((r) => r.pass).length}/${results.length}`,
    ``,
    `## Failures (${fails.length})`,
    ...fails.map(
      (f) =>
        `- **${f.id}** sim=${f.similarity} ans=${f.answerSim} src=${f.sourceSim} modes=${f.localMode}/${f.prodMode}\n  - ${f.title.slice(0, 100)}\n  - local: ${f.localPreview}\n  - prod: ${f.prodPreview}`,
    ),
  ].join("\n");
  writeFileSync(REPORT_MD, md);
}

async function main() {
  const questions = loadQuestions();
  console.log(
    JSON.stringify({
      event: "reddit_parity_start",
      prodUrl: PROD_URL,
      cases: questions.length,
      min: MIN,
    }),
  );

  // Sequential prod calls to avoid overloading Vercel; local is fast.
  const results: CaseResult[] = [];
  for (const q of questions) {
    results.push(await evaluateOne(q));
    const last = results[results.length - 1]!;
    console.log(
      JSON.stringify({
        event: "reddit_parity_case",
        id: last.id,
        similarity: last.similarity,
        answerSim: last.answerSim,
        sourceSim: last.sourceSim,
        localMode: last.localMode,
        prodMode: last.prodMode,
        pass: last.pass,
        error: last.error,
      }),
    );
  }

  const avg = results.reduce((s, r) => s + r.similarity, 0) / results.length;
  writeReports(results, avg);

  console.log(
    JSON.stringify({
      event: "reddit_parity_done",
      ok: avg >= MIN,
      avg: Number(avg.toFixed(3)),
      passed: results.filter((r) => r.pass).length,
      total: results.length,
      failIds: results.filter((r) => !r.pass).map((r) => r.id),
      reportJson: REPORT_JSON,
    }),
  );

  process.exit(avg >= MIN ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
