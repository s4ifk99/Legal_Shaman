import type { ParsedQuery } from "@/lib/legal-search/types";
import type { TriageQuestion, TriageState } from "@/lib/legal-search/triage/types";
import { assessTriageCompleteness } from "@/lib/legal-search/triage/completeness";

/** Next single question driven by completeness scoring. */
export function nextTriageQuestion(
  state: TriageState,
  parsed: ParsedQuery,
  opts?: { afterResults?: boolean },
): TriageQuestion | null {
  const report = assessTriageCompleteness(state, parsed, opts);
  return report.nextBestQuestion ?? null;
}

export {
  FUNDING_CHIPS,
  CLIENT_TYPE_CHIPS,
  LANGUAGE_CHIPS,
  fundingQuestion,
  locationQuestion,
} from "@/lib/legal-search/triage/question-bank";
