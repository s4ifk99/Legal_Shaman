import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import type { ParsedQuery } from "@/lib/legal-search/types";
import type { TriageCompletenessReport } from "@/lib/legal-search/triage/completeness";
import {
  issueClarificationQuestion,
  subIssueQuestion,
} from "@/lib/legal-search/triage/question-bank";
import { assessTriageConfidence } from "@/lib/legal-search/triage/triage-engine";
import type {
  FundingPreference,
  FundingRoute,
  TriageQuestion,
  TriageState,
} from "@/lib/legal-search/triage/types";

/** Default section/route order when funding preference is unsure (free help first). */
export const DEFAULT_FUNDING_ROUTE_ORDER: FundingRoute[] = [
  "pro_bono",
  "legal_aid",
  "private",
];

const PRIVATE_EXPLICIT =
  /\b(private solicitor|private lawyer|private\s+\w+\s+solicitor|hire a lawyer|consultation|fixed fee|pay for)\b/i;

/**
 * Product policy §2: lawyer/solicitor means any suitable legal-help provider.
 * Used by query understanding hints — not a hard filter.
 */
export const LAWYER_TERMS_ARE_BROAD_LEGAL_HELP = true as const;

/** Product policy §4: refinements reprioritize; do not hard-filter by default. */
export const REFINEMENT_REPRIORITIZES_ONLY = true as const;

/** Product policy §5: location must never block search. */
export function locationBlocksSearch(): boolean {
  return false;
}

/** Product policy §3: prefer chips over free text. */
export function prefersMcqClarification(): boolean {
  return true;
}

/** Ordered funding routes for retrieval and UI (product policy §1). */
export function resolveFundingRouteOrder(preference: FundingPreference): FundingRoute[] {
  if (preference === "legal_aid") {
    return ["legal_aid", "pro_bono", "private"];
  }
  if (preference === "pro_bono") {
    return ["pro_bono", "legal_aid", "private"];
  }
  if (preference === "private" || preference === "fixed_fee") {
    return ["private", "pro_bono", "legal_aid"];
  }
  return [...DEFAULT_FUNDING_ROUTE_ORDER];
}

export function userExplicitlyWantsPrivate(text: string): boolean {
  return PRIVATE_EXPLICIT.test(text.toLowerCase());
}

export type OrchestrationPhase =
  | "urgent_signpost"
  | "low_confidence_emergency"
  | "search_with_refinement"
  | "clarify_before_search";

export type OrchestrationDecision = {
  phase: OrchestrationPhase;
  showResultsNow: boolean;
  shouldAskBeforeSearch: boolean;
  askWhileResultsVisible: boolean;
  showUrgentSignpostingWithoutFriction: boolean;
  lowConfidenceFlow: boolean;
};

function hasIssueHeuristic(text: string): boolean {
  return /\b(job|work|employ|dismiss|redundan|landlord|evict|visa|immigr|divorce|benefit|prison|arrest|crime|housing|solicitor|tribunal|court)\b/i.test(
    text.toLowerCase(),
  );
}

function hasClearIssue(parsed: ParsedQuery, state: TriageState): boolean {
  return Boolean(
    parsed.taxonomySlug ?? state.taxonomySlug ?? state.answers.subIssue ?? hasIssueHeuristic(state.mergedQuery),
  );
}

function isUrgent(state: TriageState, parsed: ParsedQuery): boolean {
  return state.urgency === "urgent" || state.riskFlags.length > 0 || parsed.intent === "emergency";
}

/**
 * Central orchestration decision for triage search vs clarify (policies §4, §6, §9).
 */
export function decideOrchestration(
  state: TriageState,
  parsed: ParsedQuery,
  opts?: { afterResults?: boolean },
): OrchestrationDecision {
  const confidence = assessTriageConfidence(parsed, state.answers);
  const urgent = isUrgent(state, parsed);
  const lowConfidence = confidence === "low";
  const hasIssue = hasClearIssue(parsed, state);
  const afterResults = Boolean(opts?.afterResults);

  if (urgent) {
    return {
      phase: "urgent_signpost",
      showResultsNow: true,
      shouldAskBeforeSearch: false,
      askWhileResultsVisible: afterResults,
      showUrgentSignpostingWithoutFriction: true,
      lowConfidenceFlow: false,
    };
  }

  if (lowConfidence && !afterResults) {
    return {
      phase: "low_confidence_emergency",
      showResultsNow: true,
      shouldAskBeforeSearch: false,
      askWhileResultsVisible: false,
      showUrgentSignpostingWithoutFriction: true,
      lowConfidenceFlow: true,
    };
  }

  if (afterResults) {
    return {
      phase: "search_with_refinement",
      showResultsNow: true,
      shouldAskBeforeSearch: false,
      askWhileResultsVisible: true,
      showUrgentSignpostingWithoutFriction: false,
      lowConfidenceFlow: lowConfidence,
    };
  }

  const shouldAskBeforeSearch = !hasIssue && !lowConfidence;

  return {
    phase: shouldAskBeforeSearch ? "clarify_before_search" : "search_with_refinement",
    showResultsNow: hasIssue || !shouldAskBeforeSearch,
    shouldAskBeforeSearch,
    askWhileResultsVisible: false,
    showUrgentSignpostingWithoutFriction: lowConfidence,
    lowConfidenceFlow: lowConfidence,
  };
}

export const EMERGENCY_DANGER_CHIPS = [
  { id: "yes", label: "Yes — immediate danger or emergency", value: "yes" },
  { id: "no", label: "No — not an emergency", value: "no" },
  { id: "unsure", label: "Not sure", value: "unsure" },
] as const;

export function emergencyDangerQuestion(): TriageQuestion {
  return {
    field: "emergencyDanger",
    prompt: "Are you or someone else in immediate danger or need emergency help right now?",
    chips: [...EMERGENCY_DANGER_CHIPS],
    allowSkip: true,
  };
}

const BROAD_ISSUE_CHIPS = LEGAL_ISSUE_TAXONOMY.slice(0, 10).map((e) => ({
  id: e.slug,
  label: e.canonicalName,
  value: e.slug,
}));

export function broadIssueMcqQuestion(): TriageQuestion {
  return {
    field: "subIssue",
    prompt: "What area of law is this about?",
    chips: BROAD_ISSUE_CHIPS,
    allowSkip: true,
  };
}

/**
 * Low-confidence question sequence (policy §9).
 */
export function pickLowConfidenceQuestion(
  state: TriageState,
  parsed: ParsedQuery,
): TriageQuestion | undefined {
  if (!state.stepsCompleted.includes("emergencyDanger") && !state.answers.emergencyDanger) {
    return emergencyDangerQuestion();
  }

  const dismissedEmergency =
    state.answers.emergencyDanger === "no" || state.stepsCompleted.includes("emergencyDanger");

  if (dismissedEmergency && !parsed.taxonomySlug && !state.answers.subIssue) {
    return broadIssueMcqQuestion();
  }

  if (parsed.taxonomySlug && !state.answers.subIssue) {
    const sub = subIssueQuestion(parsed);
    if (sub) return sub;
  }

  if (!parsed.taxonomySlug && !state.answers.subIssue) {
    return issueClarificationQuestion();
  }

  return undefined;
}

/** Merge orchestration rules into completeness assessment. */
export function applyOrchestrationToCompleteness(
  state: TriageState,
  parsed: ParsedQuery,
  base: TriageCompletenessReport,
  opts?: { afterResults?: boolean },
): TriageCompletenessReport {
  const decision = decideOrchestration(state, parsed, opts);
  let nextBestQuestion = base.nextBestQuestion;

  if (decision.lowConfidenceFlow && !opts?.afterResults) {
    nextBestQuestion = pickLowConfidenceQuestion(state, parsed) ?? nextBestQuestion;
  } else if (decision.askWhileResultsVisible && decision.lowConfidenceFlow) {
    nextBestQuestion = pickLowConfidenceQuestion(state, parsed) ?? nextBestQuestion;
  }

  return {
    ...base,
    canSearchNow: base.canSearchNow || decision.showResultsNow,
    shouldAskBeforeSearch: base.shouldAskBeforeSearch && decision.shouldAskBeforeSearch,
    nextBestQuestion,
  };
}
