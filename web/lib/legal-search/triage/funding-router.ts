import { resolveFundingRouteOrder } from "@/lib/legal-search/orchestration/search-agent-policy";
import type {
  FundingPreference,
  FundingRoute,
  TriageState,
} from "@/lib/legal-search/triage/types";

const LEGAL_AID_SIGNALS =
  /\b(legal aid|can't afford|cannot afford|no money|low income|laa|free lawyer|free help|law centre|law center|citizens advice|citizen'?s advice)\b/i;

const PRO_BONO_SIGNALS =
  /\b(pro bono|probono|free advice|volunteer lawyer|charity advice|community advice|not for profit help)\b/i;

const PRIVATE_SIGNALS =
  /\b(private solicitor|private lawyer|private\s+\w+\s+solicitor|best solicitor|hire a lawyer|consultation|fixed fee|pay for)\b/i;

export function detectFundingPreference(text: string): FundingPreference {
  const lower = text.toLowerCase();
  if (LEGAL_AID_SIGNALS.test(lower) && !PRIVATE_SIGNALS.test(lower)) return "legal_aid";
  if (PRO_BONO_SIGNALS.test(lower) && !PRIVATE_SIGNALS.test(lower)) return "pro_bono";
  if (PRIVATE_SIGNALS.test(lower)) return "private";
  if (/\bfixed fee\b/i.test(lower)) return "fixed_fee";
  return "unsure";
}

/** Ordered funding routes for retrieval and UI section ordering (see search-agent-policy). */
export function resolveFundingRoutes(state: TriageState): FundingRoute[] {
  const fromAnswer = state.answers.fundingPreference;
  const fromMerged = detectFundingPreference(state.mergedQuery);
  const pref: FundingPreference =
    fromAnswer ??
    (fromMerged !== "unsure" ? fromMerged : undefined) ??
    (state.fundingPreference !== "unsure" ? state.fundingPreference : "unsure");
  return resolveFundingRouteOrder(pref);
}

export function fundingPreferenceFromChip(chipId: string): FundingPreference | null {
  const map: Record<string, FundingPreference> = {
    legal_aid: "legal_aid",
    pro_bono: "pro_bono",
    fixed_fee: "fixed_fee",
    private: "private",
    unsure: "unsure",
  };
  return map[chipId] ?? null;
}

export function sectionTitleForKind(kind: FundingRoute): string {
  switch (kind) {
    case "legal_aid":
      return "Legal aid and free help";
    case "pro_bono":
      return "Free help and pro bono";
    case "private":
      return "Private solicitors and firms";
    default:
      return "Results";
  }
}
