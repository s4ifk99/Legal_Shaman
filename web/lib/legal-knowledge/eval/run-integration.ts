import type { LegalKnowledgeEvalCase, LegalKnowledgeEvalCaseResult } from "./types";
import {
  answerSafetyViolations,
  directoryPrecisionAtK,
  hasForbiddenDirectoryViolation,
  hasForbiddenSourceViolation,
  sourcePrecisionAtK,
  taxonomyMatchesExpected,
} from "./metrics";

export async function runIntegrationCase(
  testCase: LegalKnowledgeEvalCase,
  runLegalKnowledgeSearch: typeof import("../search").runLegalKnowledgeSearch,
): Promise<LegalKnowledgeEvalCaseResult> {
  const failures: string[] = [];
  const result = await runLegalKnowledgeSearch({
    query: testCase.query,
    includeDirectory: true,
  });

  const taxonomySlug = result.issueClassification.subArea ?? null;

  if (testCase.expectTaxonomySlug && !taxonomyMatchesExpected(taxonomySlug, testCase)) {
    failures.push(
      `classification subArea=${taxonomySlug} expected ${testCase.expectTaxonomySlug}`,
    );
  }

  if (
    testCase.expectSpecificIssue &&
    !result.issueClassification.specificIssue
      ?.toLowerCase()
      .includes(testCase.expectSpecificIssue.toLowerCase())
  ) {
    failures.push(
      `specificIssue=${result.issueClassification.specificIssue} expected ${testCase.expectSpecificIssue}`,
    );
  }

  if (testCase.expectUrgency && result.issueClassification.urgency !== testCase.expectUrgency) {
    failures.push(`urgency=${result.issueClassification.urgency} expected ${testCase.expectUrgency}`);
  }

  failures.push(...hasForbiddenSourceViolation(result.sources, testCase));
  failures.push(
    ...hasForbiddenDirectoryViolation(
      result.directoryResults,
      testCase,
      testCase.directoryTopK,
    ),
  );

  const { precision: sourceP3, relevantCount: relevantSources } = sourcePrecisionAtK(
    result.sources,
    testCase,
    3,
  );

  if (testCase.requireAnswerTopic && result.sources.length > 0) {
    const anyMatch = result.sources.some(
      (s) =>
        testCase.requireAnswerTopic!.test(s.title) ||
        testCase.requireAnswerTopic!.test(s.snippet),
    );
    if (!anyMatch) failures.push("no source matched requireAnswerTopic");
  }

  if (testCase.requiredDirectoryTermsAny?.length && result.directoryResults.length > 0) {
    const { relevantCount } = directoryPrecisionAtK(
      result.directoryResults,
      testCase,
      testCase.directoryTopK,
    );
    if (relevantCount === 0) {
      failures.push(
        `no directory result mentions ${testCase.requiredDirectoryTermsAny.join(" or ")}`,
      );
    }
  }

  const { precision: dirP, relevantCount: relevantDir } = directoryPrecisionAtK(
    result.directoryResults,
    testCase,
    testCase.directoryTopK,
  );

  if (
    testCase.minRelevantDirectoryInTopK != null &&
    relevantDir < testCase.minRelevantDirectoryInTopK
  ) {
    failures.push(
      `directory relevant in top-K: ${relevantDir} < min ${testCase.minRelevantDirectoryInTopK}`,
    );
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

  failures.push(...answerSafetyViolations(result.answer));

  if (testCase.forbidAnswerPhrases?.length && result.answer) {
    for (const phrase of testCase.forbidAnswerPhrases) {
      if (result.answer.toLowerCase().includes(phrase.toLowerCase())) {
        failures.push(`answer contains forbidden phrase: ${phrase}`);
      }
    }
  }

  if (testCase.requireDirectory && result.directoryResults.length === 0) {
    failures.push("expected directory results");
  }

  if (
    testCase.id === "low_confidence_clarify" &&
    result.clarifyingQuestion &&
    testCase.expectTaxonomySlug
  ) {
    const area = testCase.expectTaxonomySlug.replace(/_/g, " ");
    if (!result.clarifyingQuestion.toLowerCase().includes(area)) {
      failures.push(`clarifying question should mention ${area}`);
    }
  }

  if (
    testCase.id === "employment_commission" &&
    result.answerMode !== "graph_assembly"
  ) {
    failures.push(`expected graph_assembly answer mode, got ${result.answerMode ?? "unknown"}`);
  }

  const answerSafetyPass = answerSafetyViolations(result.answer).length === 0;
  const taxonomyAccurate = taxonomyMatchesExpected(taxonomySlug, testCase);

  return {
    caseId: testCase.id,
    query: testCase.query,
    tier: "integration",
    passed: failures.length === 0,
    failures,
    notes: testCase.notes,
    taxonomySlug,
    taxonomyAccurate,
    specificIssue: result.issueClassification.specificIssue ?? null,
    sourcePrecisionAt3: sourceP3,
    directoryPrecisionAtK: dirP,
    relevantSourcesInTop3: relevantSources,
    relevantDirectoryInTopK: relevantDir,
    confidence: result.confidence,
    sourceCount: result.sources.length,
    directoryCount: result.directoryResults.length,
    answerSafetyPass,
    intentSignals: result.debug?.intentSignals,
    answerMode: result.answerMode,
    graphClusterSize: result.debug?.conceptCluster?.length,
  };
}

export async function runIntegrationTier(
  cases: LegalKnowledgeEvalCase[],
  runLegalKnowledgeSearch: typeof import("../search").runLegalKnowledgeSearch,
): Promise<LegalKnowledgeEvalCaseResult[]> {
  const results: LegalKnowledgeEvalCaseResult[] = [];
  for (const testCase of cases) {
    try {
      results.push(await runIntegrationCase(testCase, runLegalKnowledgeSearch));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        caseId: testCase.id,
        query: testCase.query,
        tier: "integration",
        passed: false,
        failures: [`runner error: ${message}`],
        notes: testCase.notes,
        answerSafetyPass: false,
      });
    }
  }
  return results;
}
