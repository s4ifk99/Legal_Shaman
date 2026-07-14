import { casesForTier, LEGAL_KNOWLEDGE_EVAL_CASES } from "./cases";
import { runCompilerTier } from "./run-compiler";
import { runGraphRetrievalTier } from "./run-graph";
import { runIntegrationTier } from "./run-integration";
import { runUnitTier } from "./run-unit";
import type {
  LegalKnowledgeEvalAggregateMetrics,
  LegalKnowledgeEvalCase,
  LegalKnowledgeEvalCaseResult,
  LegalKnowledgeEvalReport,
  LegalKnowledgeEvalTier,
} from "./types";

const PASS_INTENT_TAXONOMY_MIN = 0.9;
const PASS_SOURCE_P3_MIN = 0.7;
const PASS_DIRECTORY_P_MIN = 0.6;
const PASS_FORBIDDEN_MAX = 0;
const PASS_ANSWER_SAFETY_MIN = 1;

export function aggregateMetrics(
  results: LegalKnowledgeEvalCaseResult[],
  tier: LegalKnowledgeEvalTier | "all",
): LegalKnowledgeEvalAggregateMetrics {
  const n = results.length;
  const passedCount = results.filter((r) => r.passed).length;

  const withTaxonomy = results.filter((r) => r.taxonomyAccurate != null);
  const taxonomyAccurate = withTaxonomy.filter((r) => r.taxonomyAccurate).length;
  const intentTaxonomyAccuracy = withTaxonomy.length
    ? taxonomyAccurate / withTaxonomy.length
    : 1;

  const withSourceP = results.filter((r) => r.sourcePrecisionAt3 != null);
  const sourcePrecisionAt3 = withSourceP.length
    ? withSourceP.reduce((s, r) => s + (r.sourcePrecisionAt3 ?? 0), 0) / withSourceP.length
    : 1;

  const withDirP = results.filter((r) => r.directoryPrecisionAtK != null);
  const directoryPrecisionAtK = withDirP.length
    ? withDirP.reduce((s, r) => s + (r.directoryPrecisionAtK ?? 0), 0) / withDirP.length
    : 1;

  const forbiddenViolations = results.filter((r) =>
    r.failures.some(
      (f) =>
        f.includes("forbidden") ||
        f.includes("Forbidden"),
    ),
  ).length;
  const forbiddenViolationRate = n ? forbiddenViolations / n : 0;

  const withSafety = results.filter((r) => r.answerSafetyPass != null);
  const safetyPass = withSafety.filter((r) => r.answerSafetyPass).length;
  const answerSafetyPassRate = withSafety.length ? safetyPass / withSafety.length : 1;

  const passCriteriaMet =
    (tier === "unit" || tier === "all"
      ? intentTaxonomyAccuracy >= PASS_INTENT_TAXONOMY_MIN
      : true) &&
    (tier === "retrieval" || tier === "all"
      ? sourcePrecisionAt3 >= PASS_SOURCE_P3_MIN
      : true) &&
    (tier === "integration" || tier === "all"
      ? directoryPrecisionAtK >= PASS_DIRECTORY_P_MIN
      : true) &&
    (tier === "compiler" ? results.every((r) => r.passed) : true) &&
    forbiddenViolationRate <= PASS_FORBIDDEN_MAX &&
    answerSafetyPassRate >= PASS_ANSWER_SAFETY_MIN;

  return {
    caseCount: n,
    passedCount,
    failedCount: n - passedCount,
    intentTaxonomyAccuracy,
    sourcePrecisionAt3,
    directoryPrecisionAtK,
    forbiddenViolationRate,
    answerSafetyPassRate,
    passCriteriaMet,
  };
}

export type RunLegalKnowledgeEvalOptions = {
  tier?: LegalKnowledgeEvalTier | "all";
  cases?: LegalKnowledgeEvalCase[];
  customQuery?: string;
};

export async function runLegalKnowledgeEval(
  options: RunLegalKnowledgeEvalOptions = {},
): Promise<LegalKnowledgeEvalReport> {
  const tier = options.tier ?? "all";
  const baseCases = options.cases ?? LEGAL_KNOWLEDGE_EVAL_CASES;
  const cases = options.customQuery
    ? [
        {
          id: "custom",
          query: options.customQuery,
          tiers: ["integration"] as LegalKnowledgeEvalTier[],
          minSources: 0,
        },
      ]
    : baseCases;

  const results: LegalKnowledgeEvalCaseResult[] = [];

  if (tier === "all" || tier === "unit") {
    const unitCases = options.customQuery
      ? cases
      : casesForTier("unit", cases);
    results.push(...runUnitTier(unitCases));
  }

  if (tier === "all" || tier === "retrieval") {
    if (!options.customQuery) {
      results.push(...(await runGraphRetrievalTier(casesForTier("retrieval", cases))));
    }
  }

  if (tier === "all" || tier === "compiler") {
    if (!options.customQuery) {
      results.push(
        ...(await runCompilerTier([
          {
            id: "compiler_employment_fixture",
            query: "integrate ACAS commission guidance",
            tiers: ["compiler"],
          },
        ])),
      );
    }
  }

  if (tier === "all" || tier === "integration") {
    const { runLegalKnowledgeSearch } = await import("../search");
    const integrationCases = options.customQuery
      ? cases
      : casesForTier("integration", cases);
    results.push(
      ...(await runIntegrationTier(integrationCases, runLegalKnowledgeSearch)),
    );
  }

  const aggregate = aggregateMetrics(results, tier);

  return {
    generatedAt: new Date().toISOString(),
    tier,
    aggregate,
    passCriteria: {
      intentTaxonomyAccuracyMin: PASS_INTENT_TAXONOMY_MIN,
      sourcePrecisionAt3Min: PASS_SOURCE_P3_MIN,
      directoryPrecisionAtKMin: PASS_DIRECTORY_P_MIN,
      forbiddenViolationRateMax: PASS_FORBIDDEN_MAX,
      answerSafetyPassRateMin: PASS_ANSWER_SAFETY_MIN,
    },
    results,
  };
}
