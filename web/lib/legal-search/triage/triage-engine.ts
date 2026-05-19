import type { ParsedQuery } from "@/lib/legal-search/types";
import type { TriageAnswers, TriageConfidence } from "@/lib/legal-search/triage/types";
import { detectVagueLegalQuery } from "@/lib/legal-search/vague-query-rescue";

export function assessTriageConfidence(
  parsed: ParsedQuery,
  answers: Partial<TriageAnswers>,
): TriageConfidence {
  const hasTaxonomy = Boolean(parsed.taxonomySlug);
  const hasSubIssue = Boolean(answers.subIssue);
  const vague = detectVagueLegalQuery(parsed);

  if (hasTaxonomy && (parsed.queryConfidence === "high" || (parsed.confidence ?? 0) >= 0.7)) {
    return "high";
  }
  if (hasTaxonomy && hasSubIssue) return "high";
  if (hasTaxonomy && !vague) return "medium";
  if (hasSubIssue && answers.location) return "medium";
  if (vague || parsed.queryConfidence === "low") return "low";
  if (hasTaxonomy) return "medium";
  return "low";
}

export function shouldSearchBeforeNextQuestion(
  confidence: TriageConfidence,
  hasResults: boolean,
): boolean {
  if (confidence === "high") return true;
  if (confidence === "medium" && !hasResults) return true;
  return false;
}

export function shouldClarifyBeforeSearch(confidence: TriageConfidence): boolean {
  return confidence === "low";
}
