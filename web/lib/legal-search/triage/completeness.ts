import {
  applyOrchestrationToCompleteness,
  locationBlocksSearch,
} from "@/lib/legal-search/orchestration/search-agent-policy";
import type { ParsedQuery } from "@/lib/legal-search/types";
import type {
  TriageAnswers,
  TriageQuestion,
  TriageState,
} from "@/lib/legal-search/triage/types";
import { detectFundingPreference } from "@/lib/legal-search/triage/funding-router";
import { assessTriageConfidence } from "@/lib/legal-search/triage/triage-engine";
import {
  issueClarificationQuestion,
  questionForField,
  subIssueQuestion,
} from "@/lib/legal-search/triage/question-bank";
import type { QuestionBankId } from "@/lib/legal-search/triage/question-bank";

export type CompletenessField =
  | "taxonomy"
  | "location"
  | "urgency"
  | "funding"
  | "client_type"
  | "language"
  | "accessibility"
  | "court_deadline"
  | "funding_route";

const FIELD_WEIGHTS: Record<CompletenessField, number> = {
  taxonomy: 0.22,
  location: 0.14,
  urgency: 0.1,
  funding: 0.2,
  client_type: 0.06,
  language: 0.06,
  accessibility: 0.06,
  court_deadline: 0.1,
  funding_route: 0.06,
};

export type TriageCompletenessReport = {
  completenessScore: number;
  missingFields: CompletenessField[];
  nextBestQuestion?: TriageQuestion;
  canSearchNow: boolean;
  shouldAskBeforeSearch: boolean;
};

function isAnswered(state: TriageState, field: keyof TriageAnswers | "subIssue"): boolean {
  if (state.stepsCompleted.includes(field)) return true;
  if (field === "subIssue") return Boolean(state.answers.subIssue);
  return state.answers[field] != null;
}

function hasTaxonomy(parsed: ParsedQuery, state: TriageState): boolean {
  return Boolean(parsed.taxonomySlug ?? state.taxonomySlug ?? state.answers.subIssue);
}

/** Colloquial issue signals when taxonomy slug is not yet assigned. */
function hasIssueHeuristic(text: string): boolean {
  return /\b(job|work|employ|dismiss|redundan|landlord|evict|visa|immigr|divorce|benefit|prison|arrest|crime|housing|solicitor|tribunal|court)\b/i.test(
    text.toLowerCase(),
  );
}

function hasClearIssue(parsed: ParsedQuery, state: TriageState): boolean {
  return hasTaxonomy(parsed, state) || hasIssueHeuristic(state.mergedQuery);
}

function hasLocation(parsed: ParsedQuery, answers: Partial<TriageAnswers>): boolean {
  return Boolean(parsed.location || parsed.postcode || answers.location || answers.postcode);
}

function hasFundingKnown(state: TriageState, parsed: ParsedQuery): boolean {
  if (state.answers.fundingPreference) return true;
  if (state.fundingPreference !== "unsure") return true;
  if (state.stepsCompleted.includes("fundingPreference")) return true;
  const detected = detectFundingPreference(state.mergedQuery);
  return detected !== "unsure";
}

function hasUrgencyKnown(state: TriageState): boolean {
  return state.urgency !== "normal" || state.riskFlags.length > 0;
}

function fieldSatisfied(
  field: CompletenessField,
  state: TriageState,
  parsed: ParsedQuery,
): boolean {
  switch (field) {
    case "taxonomy":
      return hasClearIssue(parsed, state);
    case "location":
      return hasLocation(parsed, state.answers);
    case "urgency":
      return hasUrgencyKnown(state) || parsed.intent === "emergency";
    case "funding":
      return hasFundingKnown(state, parsed);
    case "client_type":
      return state.clientType !== "unsure" || isAnswered(state, "clientType");
    case "language":
      return isAnswered(state, "language");
    case "accessibility":
      return isAnswered(state, "accessibility");
    case "court_deadline":
      return isAnswered(state, "courtOrDeadline");
    case "funding_route":
      return state.fundingRoutes.length > 0 || hasFundingKnown(state, parsed);
    default:
      return false;
  }
}

function pickNextQuestion(
  state: TriageState,
  parsed: ParsedQuery,
  missing: CompletenessField[],
  opts?: { afterResults?: boolean; urgent?: boolean },
): TriageQuestion | undefined {
  const priorityBeforeSearch: CompletenessField[] = [
    "taxonomy",
    "funding",
    "urgency",
    "client_type",
  ];
  const priorityAfterSearch: CompletenessField[] = [
    "location",
    "funding",
    "court_deadline",
    "language",
    "accessibility",
    "client_type",
  ];

  const order = opts?.afterResults ? priorityAfterSearch : priorityBeforeSearch;

  for (const field of order) {
    if (!missing.includes(field)) continue;

    if (field === "taxonomy") {
      if (!parsed.taxonomySlug && !state.answers.subIssue) {
        return issueClarificationQuestion();
      }
      const sub = subIssueQuestion(parsed);
      if (sub && !isAnswered(state, "subIssue")) return sub;
      continue;
    }

    if (field === "funding" && opts?.afterResults) {
      return questionForField("funding", parsed) ?? undefined;
    }
    if (field === "funding" && !opts?.afterResults && !hasFundingKnown(state, parsed)) {
      if (/\b(not sure|unsure|don't know|do not know)\b/i.test(state.mergedQuery)) {
        return questionForField("funding", parsed) ?? undefined;
      }
    }

    if (field === "location") {
      return questionForField("location", parsed) ?? undefined;
    }
    if (field === "court_deadline" && (state.urgency !== "normal" || state.riskFlags.length)) {
      return questionForField("court_deadline", parsed) ?? undefined;
    }
    if (field === "language") {
      return questionForField("language", parsed) ?? undefined;
    }
    if (field === "accessibility") {
      return questionForField("accessibility", parsed) ?? undefined;
    }
    if (field === "client_type") {
      return questionForField("client_type", parsed) ?? undefined;
    }
  }

  if (!opts?.afterResults && missing.includes("funding")) {
    return questionForField("funding", parsed) ?? undefined;
  }

  return undefined;
}

export function assessTriageCompleteness(
  state: TriageState,
  parsed: ParsedQuery,
  opts?: { afterResults?: boolean },
): TriageCompletenessReport {
  const confidence = assessTriageConfidence(parsed, state.answers);
  const urgent = state.urgency === "urgent" || state.riskFlags.length > 0;

  const missingFields: CompletenessField[] = [];
  let score = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS) as [
    CompletenessField,
    number,
  ][]) {
    if (fieldSatisfied(field, state, parsed)) {
      score += weight;
    } else {
      missingFields.push(field);
    }
  }

  const completenessScore = Math.round(score * 1000) / 1000;
  const hasIssue = hasClearIssue(parsed, state);

  const shouldAskBeforeSearch =
    !urgent &&
    !hasIssue &&
    confidence !== "low" &&
    missingFields.includes("taxonomy") &&
    !opts?.afterResults;

  const canSearchNow =
    urgent ||
    hasIssue ||
    isAnswered(state, "subIssue") ||
    confidence === "low" ||
    completenessScore >= 0.35;

  let nextBestQuestion: TriageQuestion | undefined;

  if (shouldAskBeforeSearch) {
    nextBestQuestion = pickNextQuestion(state, parsed, missingFields, {
      afterResults: false,
      urgent,
    });
  } else if (canSearchNow && opts?.afterResults) {
    nextBestQuestion = pickNextQuestion(state, parsed, missingFields, {
      afterResults: true,
      urgent,
    });
  } else if (!canSearchNow) {
    nextBestQuestion = pickNextQuestion(state, parsed, missingFields, {
      afterResults: false,
      urgent,
    });
  } else if (canSearchNow && !opts?.afterResults && missingFields.includes("funding")) {
    if (!hasFundingKnown(state, parsed)) {
      /* search first with mixed routes; ask funding after results */
    }
  }

  if (!nextBestQuestion && !opts?.afterResults && shouldAskBeforeSearch) {
    nextBestQuestion = issueClarificationQuestion();
  }

  const base: TriageCompletenessReport = {
    completenessScore,
    missingFields: locationBlocksSearch()
      ? missingFields
      : missingFields.filter((f) => f !== "location"),
    nextBestQuestion,
    canSearchNow,
    shouldAskBeforeSearch,
  };

  return applyOrchestrationToCompleteness(state, parsed, base, opts);
}

export function fundingRouteDecisionLabel(
  routes: TriageState["fundingRoutes"],
  preference: TriageState["fundingPreference"],
): string {
  if (!routes.length) return `preference=${preference}, routes=default_mixed`;
  return `preference=${preference}, primary=${routes[0]}, order=${routes.join(">")}`;
}

export function urgencyDecisionLabel(state: TriageState): string {
  return `level=${state.urgency}, risks=${state.riskFlags.join(",") || "none"}`;
}

export function externalFallbackDecisionLabel(
  triggered: boolean,
  reason?: string,
): string {
  return triggered ? `triggered:${reason ?? "yes"}` : "not_triggered";
}
