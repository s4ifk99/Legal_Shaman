import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { resolveConceptCluster } from "@/lib/knowledge-compiler/assemble-answer";
import { pageMatchesIntent } from "@/lib/knowledge-compiler/page-index";
import { wikiPagePublicUrl } from "@/lib/wiki/public-url";

import { classifyLegalIssue } from "../classify";
import { deriveLegalSearchIntent } from "../search-intent";
import { buildEvalSearchContext } from "../search-context";
import type { LegalSearchContext } from "../search-context";
import type { LegalKnowledgeEvalCase, LegalKnowledgeEvalCaseResult } from "./types";
import { gradeSourceRelevance, taxonomyMatchesExpected } from "./metrics";

function buildSyncContext(query: string): LegalSearchContext {
  return buildEvalSearchContext(query);
}

export async function runGraphRetrievalCase(
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

  const cluster = await resolveConceptCluster(intent, testCase.query);
  if (!cluster?.primary.page) {
    failures.push("no concept cluster resolved");
    return {
      caseId: testCase.id,
      query: testCase.query,
      tier: "retrieval",
      passed: false,
      failures,
      notes: testCase.notes,
      taxonomySlug,
      taxonomyAccurate: taxonomyMatchesExpected(taxonomySlug, testCase),
      pagePrecisionAt3: 0,
      graphClusterSize: 0,
      answerSafetyPass: true,
    };
  }

  const pages = [
    cluster.primary.page,
    ...cluster.related.map((r) => r.page).filter(Boolean),
  ].slice(0, 3);

  const sources = pages.map((p) => ({
    title: p!.title,
    url: wikiPagePublicUrl(p!.id),
    source: "Legal Shaman Wiki",
    snippet: p!.summary,
    score: 1,
  }));

  let relevantCount = 0;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const page = pages[i]!;
    const { relevant } = gradeSourceRelevance(source, testCase);
    if (relevant) relevantCount += 1;
    if (!pageMatchesIntent(page, intent)) {
      failures.push(`page failed intent guard: ${source.title}`);
    }
  }

  if (testCase.requiredSourceTermsAny?.length && relevantCount === 0) {
    failures.push("no page matched requiredSourceTermsAny in cluster");
  }

  for (const source of sources) {
    if (testCase.forbiddenSourceTitleTerms?.length) {
      for (const term of testCase.forbiddenSourceTitleTerms) {
        if (source.title.toLowerCase().includes(term.toLowerCase())) {
          failures.push(`forbidden page title: ${term}`);
        }
      }
    }
  }

  const pagePrecisionAt3 = pages.length ? relevantCount / pages.length : 0;

  return {
    caseId: testCase.id,
    query: testCase.query,
    tier: "retrieval",
    passed: failures.length === 0,
    failures,
    notes: testCase.notes,
    taxonomySlug,
    taxonomyAccurate: taxonomyMatchesExpected(taxonomySlug, testCase),
    pagePrecisionAt3,
    sourcePrecisionAt3: pagePrecisionAt3,
    relevantSourcesInTop3: relevantCount,
    graphClusterSize: pages.length,
    answerSafetyPass: true,
  };
}

export async function runGraphRetrievalTier(
  cases: LegalKnowledgeEvalCase[],
): Promise<LegalKnowledgeEvalCaseResult[]> {
  const results: LegalKnowledgeEvalCaseResult[] = [];
  for (const testCase of cases) {
    try {
      results.push(await runGraphRetrievalCase(testCase));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        caseId: testCase.id,
        query: testCase.query,
        tier: "retrieval",
        passed: false,
        failures: [`graph retrieval error: ${message}`],
        notes: testCase.notes,
        answerSafetyPass: false,
      });
    }
  }
  return results;
}
