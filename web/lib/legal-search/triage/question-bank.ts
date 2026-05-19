import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import type { ParsedQuery } from "@/lib/legal-search/types";
import type { TriageQuestion, TriageQuestionChip } from "@/lib/legal-search/triage/types";

export type QuestionBankId =
  | "issue"
  | "sub_issue"
  | "location"
  | "funding"
  | "urgency"
  | "language"
  | "accessibility"
  | "court_deadline"
  | "client_type";

export const FUNDING_CHIPS: TriageQuestionChip[] = [
  { id: "legal_aid", label: "Legal aid", value: "legal_aid" },
  { id: "pro_bono", label: "Free / pro bono help", value: "pro_bono" },
  { id: "fixed_fee", label: "Fixed fee", value: "fixed_fee" },
  { id: "private", label: "Private solicitor", value: "private" },
  { id: "unsure", label: "Not sure", value: "unsure" },
];

export const CLIENT_TYPE_CHIPS: TriageQuestionChip[] = [
  { id: "individual", label: "Individual", value: "individual" },
  { id: "business", label: "Business", value: "business" },
  { id: "charity", label: "Charity", value: "charity" },
  { id: "unsure", label: "Not sure", value: "unsure" },
];

export const URGENCY_CHIPS: TriageQuestionChip[] = [
  { id: "urgent", label: "Yes — urgent", value: "urgent" },
  { id: "soon", label: "Within a few weeks", value: "soon" },
  { id: "not_urgent", label: "Not urgent", value: "not_urgent" },
];

export const LANGUAGE_CHIPS: TriageQuestionChip[] = [
  { id: "urdu", label: "Urdu", value: "Urdu" },
  { id: "punjabi", label: "Punjabi", value: "Punjabi" },
  { id: "polish", label: "Polish", value: "Polish" },
  { id: "arabic", label: "Arabic", value: "Arabic" },
  { id: "none", label: "English only", value: "English" },
];

export const COURT_DEADLINE_CHIPS: TriageQuestionChip[] = [
  { id: "yes", label: "Yes — soon", value: "yes" },
  { id: "no", label: "No", value: "no" },
  { id: "unsure", label: "Not sure", value: "unsure" },
];

export function issueClarificationQuestion(): TriageQuestion {
  return {
    field: "subIssue",
    prompt: "What type of legal issue is this about? (e.g. work, housing, family, immigration)",
    allowSkip: false,
  };
}

export function subIssueQuestion(parsed: ParsedQuery): TriageQuestion | null {
  const slug = parsed.taxonomySlug;
  if (!slug) return null;
  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === slug);
  if (!entry?.subIssues.length) return null;
  return {
    field: "subIssue",
    prompt:
      entry.clarificationQuestions[0] ??
      `What best describes your ${entry.canonicalName.toLowerCase()} issue?`,
    chips: entry.subIssues.slice(0, 6).map((s) => ({
      id: s.toLowerCase().replace(/\s+/g, "_"),
      label: s,
      value: s,
    })),
    allowSkip: true,
  };
}

export function locationQuestion(): TriageQuestion {
  return {
    field: "location",
    prompt: "Where are you based, or where did the issue happen?",
    allowSkip: true,
  };
}

export function fundingQuestion(): TriageQuestion {
  return {
    field: "fundingPreference",
    prompt:
      "How would you like to pay for legal help, if at all?",
    chips: [...FUNDING_CHIPS],
    allowSkip: true,
  };
}

export function urgencyQuestion(): TriageQuestion {
  return {
    field: "courtOrDeadline",
    prompt: "How urgent is this? (This helps us signpost you appropriately.)",
    chips: [...URGENCY_CHIPS],
    allowSkip: true,
  };
}

export function languageQuestion(): TriageQuestion {
  return {
    field: "language",
    prompt: "Do you need help in a language other than English?",
    chips: [...LANGUAGE_CHIPS],
    allowSkip: true,
  };
}

export function accessibilityQuestion(): TriageQuestion {
  return {
    field: "accessibility",
    prompt: "Do you have any accessibility needs we should consider when signposting?",
    allowSkip: true,
  };
}

export function courtDeadlineQuestion(): TriageQuestion {
  return {
    field: "courtOrDeadline",
    prompt: "Is there a court hearing, tribunal, or deadline coming up soon?",
    chips: [...COURT_DEADLINE_CHIPS],
    allowSkip: true,
  };
}

export function clientTypeQuestion(): TriageQuestion {
  return {
    field: "clientType",
    prompt: "Are you searching as an individual, a business, or a charity?",
    chips: [...CLIENT_TYPE_CHIPS],
    allowSkip: true,
  };
}

/** Map bank id → question builder. */
export const QUESTION_BANK: Record<
  QuestionBankId,
  (parsed: ParsedQuery) => TriageQuestion | null
> = {
  issue: () => issueClarificationQuestion(),
  sub_issue: (p) => subIssueQuestion(p),
  location: () => locationQuestion(),
  funding: () => fundingQuestion(),
  urgency: () => urgencyQuestion(),
  language: () => languageQuestion(),
  accessibility: () => accessibilityQuestion(),
  court_deadline: () => courtDeadlineQuestion(),
  client_type: () => clientTypeQuestion(),
};

export function questionForField(
  field: QuestionBankId | keyof import("@/lib/legal-search/triage/types").TriageAnswers | "subIssue",
  parsed: ParsedQuery,
): TriageQuestion | null {
  if (field === "subIssue") {
    return subIssueQuestion(parsed) ?? issueClarificationQuestion();
  }
  const bankId = field as QuestionBankId;
  const builder = QUESTION_BANK[bankId];
  return builder ? builder(parsed) : null;
}
