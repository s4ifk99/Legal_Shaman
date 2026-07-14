import { buildMergePlan } from "@/lib/knowledge-compiler/merge-plan";
import { matchClaimsToWikiPages } from "@/lib/knowledge-compiler/match-wiki-only";
import type { ExtractedSource } from "@/lib/knowledge-compiler/types";

import type { LegalKnowledgeEvalCase, LegalKnowledgeEvalCaseResult } from "./types";

const FIXTURE_EMPLOYMENT_SOURCE: ExtractedSource = {
  claims: [
    {
      claimText: "ACAS provides free guidance on unpaid commission disputes after leaving employment.",
      sectionTarget: "Key Information",
      conceptHint: "unpaid commission",
      taxonomySlug: "employment",
    },
    {
      claimText: "You may bring an employment tribunal claim for unpaid wages or commission.",
      sectionTarget: "Practical Guidance",
      conceptHint: "unpaid wages",
      taxonomySlug: "employment",
    },
  ],
  concepts: [{ title: "Unpaid commission after leaving employment", taxonomySlug: "employment" }],
  organisations: ["ACAS"],
  sources: ["https://www.acas.org.uk/"],
};

export async function runCompilerCase(
  testCase: LegalKnowledgeEvalCase,
): Promise<LegalKnowledgeEvalCaseResult> {
  const failures: string[] = [];
  const extracted = FIXTURE_EMPLOYMENT_SOURCE;
  const matched = matchClaimsToWikiPages(extracted);
  const plan = buildMergePlan(extracted, matched);

  if (plan.length === 0) failures.push("merge plan empty");
  if (!matched.some((m) => m.matchScore >= 2 || m.wikiPageId)) {
    failures.push("no employment concept match");
  }
  if (!plan.some((a) => a.type === "update_section" || a.type === "create_page")) {
    failures.push("no write actions in merge plan");
  }
  if (!plan.some((a) => a.type === "add_wikilink")) {
    failures.push("no wikilink actions in merge plan");
  }

  return {
    caseId: testCase.id,
    query: testCase.query,
    tier: "compiler",
    passed: failures.length === 0,
    failures,
    notes: testCase.notes,
    answerSafetyPass: true,
  };
}

export async function runCompilerTier(
  cases: LegalKnowledgeEvalCase[],
): Promise<LegalKnowledgeEvalCaseResult[]> {
  return Promise.all(cases.map(runCompilerCase));
}
