import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { inferSubIssueFromTaxonomy } from "@/lib/legal/sub-issue-rules";
import { normalizeLegalSourceUrl } from "@/lib/wiki/public-url";

import { classifyLegalIssue } from "../classify";
import { decomposeLegalSearchQuery } from "../decompose-query";
import {
  chunkMatchesIntent,
  deriveLegalSearchIntent,
  filterChunksByIntent,
  refineIntentFromChunks,
} from "../search-intent";
import { buildEvalSearchContext } from "../search-context";
import type { LegalSearchContext } from "../search-context";
import {
  EMPLOYMENT_CHUNK,
  PROPERTY_CHUNK,
} from "./fixtures/chunks";
import { EMPLOYMENT_WIKI_PAGE, PROPERTY_WIKI_PAGE } from "./fixtures/pages";
import { pageMatchesIntent } from "@/lib/knowledge-compiler/page-index";
import type { LegalKnowledgeEvalCase, LegalKnowledgeEvalCaseResult } from "./types";
import { taxonomyMatchesExpected } from "./metrics";

function buildSyncContext(query: string): LegalSearchContext {
  return buildEvalSearchContext(query);
}

function runChunkScenario(
  testCase: LegalKnowledgeEvalCase,
  failures: string[],
): void {
  if (testCase.unitChunkScenario !== "filter_property_on_employment") return;

  const context = buildSyncContext(testCase.query);
  const intent = deriveLegalSearchIntent(context);
  const filtered = filterChunksByIntent([PROPERTY_CHUNK, EMPLOYMENT_CHUNK], intent);

  if (!filtered.some((c) => c.id === "e1") || filtered.some((c) => c.id === "p1")) {
    failures.push(
      `chunk filter failed: kept ${filtered.map((c) => c.id).join(",") || "none"}`,
    );
  }
  if (chunkMatchesIntent(PROPERTY_CHUNK, intent)) {
    failures.push("property chunk should not match employment intent");
  }

  const refined = refineIntentFromChunks(
    { ...intent, taxonomySlug: undefined, confidence: "low" },
    [EMPLOYMENT_CHUNK],
  );
  if (refined.taxonomySlug !== "employment") {
    failures.push(`refine expected employment, got ${refined.taxonomySlug ?? "null"}`);
  }
}

function runUrlChecks(testCase: LegalKnowledgeEvalCase, failures: string[]): void {
  for (const check of testCase.unitUrlChecks ?? []) {
    const got = normalizeLegalSourceUrl(check.input);
    if (got !== check.expected) {
      failures.push(`url normalize: ${JSON.stringify(check.input)} → ${got}, expected ${check.expected}`);
    }
  }
}

export function runUnitCase(testCase: LegalKnowledgeEvalCase): LegalKnowledgeEvalCaseResult {
  const failures: string[] = [];
  const context = buildSyncContext(testCase.query);
  const intent = deriveLegalSearchIntent(context);
  const taxonomySlug =
    intent.taxonomySlug ??
    (context.classification.subArea || null) ??
    context.resolution?.taxonomySlug ??
    context.parsedQuery.taxonomySlug ??
    null;

  if (testCase.expectTaxonomySlug && !taxonomyMatchesExpected(taxonomySlug, testCase)) {
    failures.push(
      `taxonomy: expected ${testCase.expectTaxonomySlug}, got ${taxonomySlug ?? "null"}`,
    );
  }

  if (testCase.expectSpecificIssue) {
    const slugForSubIssue =
      testCase.expectTaxonomySlug ?? taxonomySlug ?? context.resolution?.taxonomySlug ?? "";
    const subIssue =
      inferSubIssueFromTaxonomy(testCase.query, slugForSubIssue) ??
      intent.specificIssue;
    if (!subIssue?.toLowerCase().includes(testCase.expectSpecificIssue.toLowerCase())) {
      failures.push(
        `specificIssue: expected ${testCase.expectSpecificIssue}, got ${subIssue ?? "null"}`,
      );
    }
  }

  if (testCase.expectIntentConfidence && intent.confidence !== testCase.expectIntentConfidence) {
    failures.push(
      `intent confidence: expected ${testCase.expectIntentConfidence}, got ${intent.confidence}`,
    );
  }

  for (const term of testCase.expectSuppressTerms ?? []) {
    if (!intent.suppressTerms.some((t) => t.toLowerCase() === term.toLowerCase())) {
      failures.push(`expected suppress term: ${term}`);
    }
  }

  for (const fragment of testCase.expectSemanticQueryContains ?? []) {
    if (!intent.semanticQuery.toLowerCase().includes(fragment.toLowerCase())) {
      failures.push(`semantic query missing: ${fragment}`);
    }
  }

  if (testCase.expectUrgency && context.classification.urgency !== testCase.expectUrgency) {
    failures.push(
      `urgency: expected ${testCase.expectUrgency}, got ${context.classification.urgency}`,
    );
  }

  if (testCase.unitChunkScenario === "filter_property_on_employment") {
    const context = buildSyncContext(testCase.query);
    const intent = deriveLegalSearchIntent(context);
    runChunkScenario(testCase, failures);

    if (!pageMatchesIntent(EMPLOYMENT_WIKI_PAGE, intent)) {
      failures.push("employment wiki page should match employment intent");
    }
    if (pageMatchesIntent(PROPERTY_WIKI_PAGE, intent)) {
      failures.push("property wiki page should not match employment intent");
    }
  } else {
    runChunkScenario(testCase, failures);
  }
  runUrlChecks(testCase, failures);

  const criteria = decomposeLegalSearchQuery({
    query: testCase.query,
    includeDirectory: true,
    context,
    intent,
  });
  if (criteria.length === 0 && testCase.query.length >= 2) {
    failures.push("decomposeLegalSearchQuery returned no criteria");
  } else if (!criteria.some((c) => c.kind === "legal_issue")) {
    failures.push("decomposeLegalSearchQuery missing legal_issue criterion");
  }

  const taxonomyAccurate = taxonomyMatchesExpected(taxonomySlug, testCase);

  return {
    caseId: testCase.id,
    query: testCase.query,
    tier: "unit",
    passed: failures.length === 0,
    failures,
    notes: testCase.notes,
    taxonomySlug,
    taxonomyAccurate,
    specificIssue: intent.specificIssue ?? null,
    intentConfidence: intent.confidence,
    intentSignals: intent.signals,
    answerSafetyPass: true,
  };
}

export function runUnitTier(cases: LegalKnowledgeEvalCase[]): LegalKnowledgeEvalCaseResult[] {
  return cases.map(runUnitCase);
}
