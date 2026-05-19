import type { ParsedQuery } from "@/lib/legal-search/types";
import { ruleBasedParse } from "@/lib/legal-search/query-rules";
import type {
  ClientType,
  FundingPreference,
  TriageAnswers,
  TriageState,
} from "@/lib/legal-search/triage/types";
import { detectFundingPreference } from "@/lib/legal-search/triage/funding-router";
import { assessUrgency } from "@/lib/legal-search/triage/urgency-router";
import { assessTriageConfidence } from "@/lib/legal-search/triage/triage-engine";

export function createInitialTriageState(
  query: string,
  sessionId: string,
): TriageState {
  const parsed = ruleBasedParse(query);
  const fundingPreference = detectFundingPreference(query);
  const { urgency, riskFlags } = assessUrgency(query, parsed);
  const confidence = assessTriageConfidence(parsed, {});

  return {
    sessionId,
    initialQuery: query.trim(),
    mergedQuery: query.trim(),
    answers: {},
    stepsCompleted: [],
    taxonomySlug: parsed.taxonomySlug ?? null,
    confidence,
    fundingRoutes: [],
    fundingPreference,
    urgency,
    riskFlags,
    clientType: detectClientType(query),
  };
}

function detectClientType(query: string): TriageState["clientType"] {
  const lower = query.toLowerCase();
  if (/\b(business|company|employer|startup|ltd|llp)\b/.test(lower)) return "business";
  if (/\b(charity|nonprofit|non-profit|cio)\b/.test(lower)) return "charity";
  return "unsure";
}

export function applyTriageAnswer(
  state: TriageState,
  field: keyof TriageAnswers | "subIssue",
  value: string,
): TriageState {
  const answers: Partial<TriageAnswers> = { ...state.answers };
  if (field === "subIssue") {
    answers.subIssue = value;
  } else if (field === "fundingPreference") {
    answers.fundingPreference = value as FundingPreference;
  } else if (field === "clientType") {
    answers.clientType = value as ClientType;
  } else if (field === "courtOrDeadline") {
    answers.courtOrDeadline = value as TriageAnswers["courtOrDeadline"];
  } else if (field === "location") {
    answers.location = value;
  } else if (field === "postcode") {
    answers.postcode = value;
  } else if (field === "language") {
    answers.language = value;
  } else if (field === "accessibility") {
    answers.accessibility = value;
  } else if (field === "emergencyDanger") {
    answers.emergencyDanger = value as TriageAnswers["emergencyDanger"];
  }

  const mergedQuery = buildMergedQuery(state.initialQuery, answers);
  const parsed = ruleBasedParse(mergedQuery);
  const fundingPreference =
    answers.fundingPreference ?? detectFundingPreference(mergedQuery);
  const { urgency, riskFlags } = assessUrgency(mergedQuery, parsed);
  const confidence = assessTriageConfidence(parsed, answers);

  return {
    ...state,
    answers,
    mergedQuery,
    stepsCompleted: [...new Set([...state.stepsCompleted, field])],
    taxonomySlug: parsed.taxonomySlug ?? state.taxonomySlug,
    confidence,
    fundingPreference,
    urgency,
    riskFlags,
    clientType: (answers.clientType as ClientType | undefined) ?? state.clientType,
  };
}

export function skipTriageStep(
  state: TriageState,
  field: keyof TriageAnswers | "subIssue",
): TriageState {
  return {
    ...state,
    stepsCompleted: [...new Set([...state.stepsCompleted, field])],
  };
}

function buildMergedQuery(initial: string, answers: Partial<TriageAnswers>): string {
  const parts = [initial];
  if (answers.subIssue) parts.push(answers.subIssue);
  if (answers.location) parts.push(`in ${answers.location}`);
  if (answers.postcode) parts.push(answers.postcode);
  if (answers.fundingPreference === "legal_aid") parts.push("legal aid");
  if (answers.fundingPreference === "pro_bono") parts.push("pro bono free help");
  if (answers.fundingPreference === "private") parts.push("private solicitor");
  if (answers.fundingPreference === "fixed_fee") parts.push("fixed fee");
  if (answers.language) parts.push(`language ${answers.language}`);
  if (answers.courtOrDeadline === "yes") parts.push("court deadline soon");
  return parts.join(" ").trim();
}

export function parseForTriage(query: string): ParsedQuery {
  return ruleBasedParse(query);
}
