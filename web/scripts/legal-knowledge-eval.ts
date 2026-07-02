/**
 * Evaluation harness for Exa-style legal knowledge search.
 *
 * Usage:
 *   npm run legal-search:eval
 *   npm run legal-search:eval -- --query="unfair dismissal"
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

type EvalCase = {
  id: string;
  query: string;
  expectArea?: string;
  minConfidence?: number;
  maxConfidence?: number;
  minSources?: number;
  requireCitation?: boolean;
  requireDirectory?: boolean;
  emergency?: boolean;
};

const CASES: EvalCase[] = [
  { id: "unfair_dismissal", query: "I lost my job unfairly", expectArea: "employment", minSources: 0 },
  { id: "housing_disrepair", query: "my landlord won't fix damp and mould", expectArea: "housing", minSources: 0 },
  { id: "deposit_not_returned", query: "my landlord won't return my deposit", expectArea: "housing", minSources: 0 },
  {
    id: "domestic_abuse_emergency",
    query: "I need to leave home tonight because of domestic abuse",
    expectArea: "family",
    emergency: true,
    minSources: 0,
  },
  { id: "immigration_visa_refusal", query: "my visa application was refused", expectArea: "immigration", minSources: 0 },
  { id: "debt_claim", query: "I have a debt claim and bailiffs are involved", expectArea: "debt", minSources: 0 },
  { id: "small_claims", query: "how do I make a small claim in court", expectArea: "consumer", minSources: 0 },
  { id: "prison_law", query: "I need help with recall to prison", expectArea: "prison_law", minSources: 0 },
  { id: "family_child_contact", query: "I need help with child contact arrangements", expectArea: "family", minSources: 0 },
  { id: "pregnancy_discrimination", query: "I was dismissed while pregnant", expectArea: "employment", minSources: 0 },
];

function parseQueryArg(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--query="));
  return arg ? arg.split("=").slice(1).join("=").trim() : null;
}

function assertNoHallucinatedAdvice(answer: string): string[] {
  const failures: string[] = [];
  if (/\byou must\b/i.test(answer)) failures.push("answer contains 'you must'");
  if (/\bi recommend\b/i.test(answer)) failures.push("answer contains 'I recommend'");
  if (/\bguaranteed\b/i.test(answer)) failures.push("answer contains 'guaranteed'");
  return failures;
}

async function runCase(
  testCase: EvalCase,
  runLegalKnowledgeSearch: typeof import("../lib/legal-knowledge/search").runLegalKnowledgeSearch,
): Promise<{ pass: boolean; notes: string[] }> {
  const result = await runLegalKnowledgeSearch({
    query: testCase.query,
    includeDirectory: true,
  });

  const failures: string[] = [];
  const info: string[] = [];

  if (testCase.expectArea && result.issueClassification.subArea !== testCase.expectArea) {
    failures.push(
      `classification subArea=${result.issueClassification.subArea} expected ${testCase.expectArea}`,
    );
  }

  if (testCase.emergency && result.issueClassification.urgency !== "emergency") {
    failures.push(`urgency=${result.issueClassification.urgency} expected emergency`);
  }

  const minSources = testCase.minSources ?? 0;
  if (result.sources.length < minSources) {
    failures.push(`sources=${result.sources.length} < min ${minSources}`);
  }

  if (testCase.minConfidence != null && result.confidence < testCase.minConfidence) {
    failures.push(`confidence ${result.confidence} < min ${testCase.minConfidence}`);
  }
  if (testCase.maxConfidence != null && result.confidence > testCase.maxConfidence) {
    failures.push(`confidence ${result.confidence} > max ${testCase.maxConfidence}`);
  }

  if (!result.disclaimer) failures.push("missing disclaimer");
  if (!result.answer) failures.push("missing answer");

  if (testCase.requireCitation !== false && result.sources.length > 0) {
    const hasCitation = /\[\d+\]/.test(result.answer ?? "") || result.sources.length > 0;
    if (!hasCitation) failures.push("no citations in answer or sources");
  }

  failures.push(...assertNoHallucinatedAdvice(result.answer ?? ""));

  if (testCase.requireDirectory && result.directoryResults.length === 0) {
    failures.push("expected directory results");
  }

  info.push(
    `confidence=${result.confidence} sources=${result.sources.length} directory=${result.directoryResults.length} mode=${result.debug?.mode}`,
  );

  return { pass: failures.length === 0, notes: [...failures, ...info] };
}

async function main() {
  const { createPrismaClient } = await import("../lib/db/prisma");
  const { runLegalKnowledgeSearch } = await import("../lib/legal-knowledge/search");

  const singleQuery = parseQueryArg(process.argv.slice(2));
  const prisma = createPrismaClient();

  const chunkCount = await prisma.legalChunk.count();
  if (chunkCount === 0) {
    console.warn(
      "No legal_chunks in database. Run: npm run ingest:legal-knowledge (with LLM_API_KEY for embeddings)",
    );
  }

  const cases = singleQuery
    ? [{ id: "custom", query: singleQuery, minSources: 0 }]
    : CASES;

  let passed = 0;
  for (const testCase of cases) {
    const { pass, notes } = await runCase(testCase, runLegalKnowledgeSearch);
    console.info(
      JSON.stringify({
        event: "legal_search_eval",
        id: testCase.id,
        query: testCase.query,
        pass,
        notes,
      }),
    );
    if (pass) passed += 1;
  }

  await prisma.$disconnect();

  console.info(
    JSON.stringify({
      event: "legal_search_eval_summary",
      passed,
      total: cases.length,
      chunkCount,
    }),
  );

  if (passed < cases.length) process.exitCode = 1;
}

main();
