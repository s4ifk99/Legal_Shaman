import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

import { classifyLegalIssue } from "../classify";
import { hybridLegalRetrieval } from "../retrieval";
import { deriveLegalSearchIntent } from "../search-intent";
import { buildEvalSearchContext } from "../search-context";
import type { LegalSearchContext } from "../search-context";
import type { LegalKnowledgeEvalCase, LegalKnowledgeEvalCaseResult } from "./types";
import {
  hasForbiddenSourceViolation,
  sourcePrecisionAtK,
  taxonomyMatchesExpected,
} from "./metrics";

function buildSyncContext(query: string): LegalSearchContext {
  return buildEvalSearchContext(query);
}

export async function runRetrievalCase(
  testCase: LegalKnowledgeEvalCase,
): Promise<LegalKnowledgeEvalCaseResult> {
  const failures: string[] = [];
  const context = buildSyncContext(testCase.query);
  const intent = deriveLegalSearchIntent(context);
  const taxonomySlug = intent.taxonomySlug ?? context.classification.subArea ?? null;

  if (testCase.expectTaxonomySlug && !taxonomyMatchesExpected(taxonomySlug, testCase)) {
    failures.push(
      `taxonomy: expected ${testCase.expectTaxonomySlug}, got ${taxonomySlug ?? "null"}`,
    );
  }

  const { chunks } = await hybridLegalRetrieval(testCase.query, { intent });
  const sources = chunks.map((c) => ({
    title: c.title,
    url: c.sourceUrl,
    source: c.sourceName,
    snippet: c.snippet,
    score: c.finalScore,
    heading: c.heading,
  }));

  const minSources = testCase.minSources ?? 0;
  if (sources.length < minSources) {
    failures.push(`sources=${sources.length} < min ${minSources}`);
  }

  failures.push(...hasForbiddenSourceViolation(sources, testCase));

  const { precision, relevantCount } = sourcePrecisionAtK(sources, testCase, 3);

  if (
    testCase.requiredSourceTermsAny?.length &&
    sources.length > 0 &&
    relevantCount === 0
  ) {
    failures.push("no source matched requiredSourceTermsAny in top 3");
  }

  if (testCase.forbiddenSourceTitleTerms?.length) {
    for (const source of sources.slice(0, 3)) {
      for (const term of testCase.forbiddenSourceTitleTerms) {
        if (source.title.toLowerCase().includes(term.toLowerCase())) {
          failures.push(`forbidden source title in retrieval: ${term}`);
        }
      }
    }
  }

  const taxonomyAccurate = taxonomyMatchesExpected(taxonomySlug, testCase);

  return {
    caseId: testCase.id,
    query: testCase.query,
    tier: "retrieval",
    passed: failures.length === 0,
    failures,
    notes: testCase.notes,
    taxonomySlug,
    taxonomyAccurate,
    specificIssue: intent.specificIssue ?? null,
    intentConfidence: intent.confidence,
    intentSignals: intent.signals,
    sourcePrecisionAt3: precision,
    relevantSourcesInTop3: relevantCount,
    sourceCount: sources.length,
    answerSafetyPass: true,
  };
}

export async function runRetrievalTier(
  cases: LegalKnowledgeEvalCase[],
): Promise<LegalKnowledgeEvalCaseResult[]> {
  const results: LegalKnowledgeEvalCaseResult[] = [];
  for (const testCase of cases) {
    try {
      results.push(await runRetrievalCase(testCase));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        caseId: testCase.id,
        query: testCase.query,
        tier: "retrieval",
        passed: false,
        failures: [`runner error: ${message}`],
        notes: testCase.notes,
        answerSafetyPass: false,
      });
    }
  }
  return results;
}
