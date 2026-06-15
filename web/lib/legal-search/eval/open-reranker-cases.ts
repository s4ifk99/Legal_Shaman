import {
  buildOpenRerankerDocumentText,
  buildOpenRerankerQueryText,
} from "@/lib/legal-search/open-reranker/document-text";
import { rerankerInfluenceGate } from "@/lib/legal-search/open-reranker/blend-gates";
import { emptyScores } from "@/lib/legal-search/ranking";
import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";

function mockResult(over: Partial<SearchResult> & Pick<SearchResult, "id" | "title">): SearchResult {
  const { scores: scoreOver, ...rest } = over;
  return {
    source: "sra",
    description: "",
    practiceAreas: [],
    categories: [],
    raw: {},
    explanation: "",
    scores: { ...emptyScores({ final: 0.5, practiceArea: 0.5 }), ...scoreOver },
    ...rest,
  };
}

export function runOpenRerankerEval(): { failed: number; messages: string[] } {
  let failed = 0;
  const messages: string[] = [];
  const fail = (msg: string) => {
    messages.push(`FAIL open-reranker: ${msg}`);
    failed++;
  };

  const parsed: ParsedQuery = {
    rawText: "employment tribunal unfair dismissal",
    semanticQuery: "employment tribunal unfair dismissal",
    practiceAreaSlug: "employment",
    taxonomySlug: "employment",
    intent: "find_lawyer",
    expandedSearchText: "employment law unfair dismissal discrimination redundancy tribunal",
  };
  const queryText = buildOpenRerankerQueryText("employment tribunal unfair dismissal", parsed);
  if (!queryText.toLowerCase().includes("employment")) {
    fail("query text should include user query");
  }

  const doc = mockResult({
    id: "sra:1",
    title: "Employment Law Partners",
    practiceAreas: ["Employment Law"],
    description: "Unfair dismissal and tribunal representation",
    scores: emptyScores({ practiceArea: 0.9, final: 0.7 }),
  });
  const docText = buildOpenRerankerDocumentText(doc, parsed);
  const docLower = docText.toLowerCase();
  if (!docLower.includes("employment law partners") || !docLower.includes("employment")) {
    fail("document text should include title and practice areas");
  }

  const weakTax = mockResult({
    id: "sra:2",
    title: "Commercial Litigation LLP",
    practiceAreas: ["Commercial"],
    scores: emptyScores({ practiceArea: 0.1, final: 0.6 }),
  });
  const gateWeak = rerankerInfluenceGate(weakTax, {
    ...parsed,
    practiceAreaSlug: "employment",
  });
  if (gateWeak > 0.2) {
    fail("weak taxonomy match should heavily gate reranker influence");
  }

  const strongTax = mockResult({
    id: "sra:3",
    title: "Work Rights Solicitors",
    practiceAreas: ["Employment Law"],
    scores: emptyScores({ practiceArea: 0.95, final: 0.65 }),
  });
  const gateStrong = rerankerInfluenceGate(strongTax, parsed);
  if (gateStrong < 0.9) {
    fail("strong taxonomy match should allow full reranker influence");
  }

  if (failed === 0) messages.push("open-reranker eval OK");
  return { failed, messages };
}
