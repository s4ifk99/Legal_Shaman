import type { LegalKnowledgeEvalCase, GradedDirectoryResult, GradedSource } from "./types";
import type { LegalSearchSourceHit } from "@/lib/legal-knowledge/types";

const ANSWER_BANNED = /\b(you must|i recommend|guaranteed)\b/i;

function hayIncludes(hay: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  return t.length >= 3 && hay.includes(t);
}

function sourceHaystack(source: Pick<LegalSearchSourceHit, "title" | "snippet" | "url">): string {
  return [source.title, source.snippet, source.url].join(" ").toLowerCase();
}

function directoryHaystack(result: {
  title: string;
  explanation?: string;
}): string {
  return [result.title, result.explanation ?? ""].join(" ").toLowerCase();
}

export function gradeSourceRelevance(
  source: Pick<LegalSearchSourceHit, "title" | "snippet" | "url">,
  testCase: LegalKnowledgeEvalCase,
): { relevant: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const hay = sourceHaystack(source);

  if (testCase.forbiddenSourceTitleTerms?.length) {
    for (const term of testCase.forbiddenSourceTitleTerms) {
      if (hayIncludes(source.title.toLowerCase(), term.toLowerCase())) {
        return { relevant: false, reasons: [`forbidden_title:${term}`] };
      }
    }
  }

  if (testCase.forbiddenSourceTermsAny?.length) {
    for (const term of testCase.forbiddenSourceTermsAny) {
      if (hayIncludes(hay, term)) {
        return { relevant: false, reasons: [`forbidden_term:${term}`] };
      }
    }
  }

  if (testCase.requiredSourceTermsAny?.length) {
    for (const term of testCase.requiredSourceTermsAny) {
      if (hayIncludes(hay, term)) {
        reasons.push(`term:${term}`);
        break;
      }
    }
  }

  if (testCase.expectTaxonomySlug && reasons.length === 0) {
    const slugLabel = testCase.expectTaxonomySlug.replace(/_/g, " ");
    if (hayIncludes(hay, slugLabel)) {
      reasons.push(`taxonomy:${testCase.expectTaxonomySlug}`);
    }
  }

  return { relevant: reasons.length > 0, reasons };
}

export function gradeDirectoryRelevance(
  result: { title: string; explanation?: string },
  testCase: LegalKnowledgeEvalCase,
): { relevant: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const hay = directoryHaystack(result);

  if (testCase.forbiddenDirectoryTerms?.length) {
    for (const term of testCase.forbiddenDirectoryTerms) {
      if (hayIncludes(hay, term)) {
        return { relevant: false, reasons: [`forbidden:${term}`] };
      }
    }
  }

  if (testCase.requiredDirectoryTermsAny?.length) {
    for (const term of testCase.requiredDirectoryTermsAny) {
      if (hayIncludes(hay, term)) {
        reasons.push(`term:${term}`);
        break;
      }
    }
  }

  if (testCase.expectTaxonomySlug && reasons.length === 0) {
    const slugLabel = testCase.expectTaxonomySlug.replace(/_/g, " ");
    if (hayIncludes(hay, slugLabel)) {
      reasons.push(`taxonomy:${testCase.expectTaxonomySlug}`);
    }
  }

  return { relevant: reasons.length > 0, reasons };
}

export function sourcePrecisionAtK(
  sources: LegalSearchSourceHit[],
  testCase: LegalKnowledgeEvalCase,
  k = 3,
): { precision: number; graded: GradedSource[]; relevantCount: number } {
  const graded: GradedSource[] = sources.slice(0, k).map((source, i) => {
    const { relevant, reasons } = gradeSourceRelevance(source, testCase);
    return {
      rank: i + 1,
      ...source,
      relevant,
      relevanceReasons: reasons,
      haystack: sourceHaystack(source),
    };
  });
  const relevantCount = graded.filter((g) => g.relevant).length;
  return {
    precision: graded.length ? relevantCount / graded.length : 0,
    graded,
    relevantCount,
  };
}

export function directoryPrecisionAtK(
  results: Array<{ id: string; title: string; explanation?: string }>,
  testCase: LegalKnowledgeEvalCase,
  k?: number,
): { precision: number; graded: GradedDirectoryResult[]; relevantCount: number } {
  const topK = k ?? testCase.directoryTopK ?? 6;
  const graded: GradedDirectoryResult[] = results.slice(0, topK).map((result, i) => {
    const { relevant, reasons } = gradeDirectoryRelevance(result, testCase);
    return {
      rank: i + 1,
      id: result.id,
      title: result.title,
      explanation: result.explanation,
      relevant,
      relevanceReasons: reasons,
      haystack: directoryHaystack(result),
    };
  });
  const relevantCount = graded.filter((g) => g.relevant).length;
  return {
    precision: graded.length ? relevantCount / graded.length : 0,
    graded,
    relevantCount,
  };
}

export function taxonomyMatchesExpected(
  slug: string | null | undefined,
  testCase: LegalKnowledgeEvalCase,
): boolean {
  if (!testCase.expectTaxonomySlug) return true;
  if (!slug) return false;
  if (slug === testCase.expectTaxonomySlug) return true;
  return (testCase.acceptableTaxonomySlugs ?? []).includes(slug);
}

export function answerSafetyViolations(answer: string | null | undefined): string[] {
  if (!answer?.trim()) return [];
  const failures: string[] = [];
  if (/\byou must\b/i.test(answer)) failures.push("answer contains 'you must'");
  if (/\bi recommend\b/i.test(answer)) failures.push("answer contains 'I recommend'");
  if (/\bguaranteed\b/i.test(answer)) failures.push("answer contains 'guaranteed'");
  if (ANSWER_BANNED.test(answer) && failures.length === 0) {
    failures.push("answer contains banned advisory phrase");
  }
  return failures;
}

export function hasForbiddenSourceViolation(
  sources: LegalSearchSourceHit[],
  testCase: LegalKnowledgeEvalCase,
): string[] {
  const failures: string[] = [];
  for (const source of sources) {
    const hay = sourceHaystack(source);
    if (testCase.forbiddenSourceTitleTerms?.length) {
      for (const term of testCase.forbiddenSourceTitleTerms) {
        if (hayIncludes(source.title.toLowerCase(), term.toLowerCase())) {
          failures.push(`forbidden source title: ${term} (${source.title})`);
        }
      }
    }
    if (testCase.forbiddenSourceTermsAny?.length) {
      for (const term of testCase.forbiddenSourceTermsAny) {
        if (hayIncludes(hay, term)) {
          failures.push(`forbidden source term: ${term} (${source.title})`);
        }
      }
    }
  }
  return failures;
}

export function hasForbiddenDirectoryViolation(
  results: Array<{ title: string; explanation?: string }>,
  testCase: LegalKnowledgeEvalCase,
  k?: number,
): string[] {
  const failures: string[] = [];
  const top = results.slice(0, k ?? testCase.directoryTopK ?? 6);
  for (const result of top) {
    const hay = directoryHaystack(result);
    if (testCase.forbiddenDirectoryTerms?.length) {
      for (const term of testCase.forbiddenDirectoryTerms) {
        if (hayIncludes(hay, term)) {
          failures.push(`directory contains forbidden term: ${term} (${result.title})`);
        }
      }
    }
  }
  return failures;
}

export function intentAccuracy(
  results: Array<{ taxonomyAccurate?: boolean; caseId: string }>,
  cases: LegalKnowledgeEvalCase[],
): number {
  const withExpected = cases.filter((c) => c.expectTaxonomySlug);
  if (!withExpected.length) return 1;
  const accurate = withExpected.filter((c) => {
    const r = results.find((x) => x.caseId === c.id);
    return r?.taxonomyAccurate === true;
  }).length;
  return accurate / withExpected.length;
}
