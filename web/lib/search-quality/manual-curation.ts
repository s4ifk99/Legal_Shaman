import type { FailedSearchRow } from "@/lib/search-quality/types";

export type ManualCurationSuggestion = {
  title: string;
  detail: string;
  href?: string;
  action: "review_enrichment" | "taxonomy_alias" | "eval_case" | "provider_boost_doc";
};

/**
 * Turn analytics rows into concrete next steps (links into existing admin flows).
 */
export function buildManualCurationSuggestions(rows: FailedSearchRow[]): ManualCurationSuggestion[] {
  const out: ManualCurationSuggestion[] = [];
  const zero = rows.filter((r) => r.failureKind === "zero_results").length;
  if (zero > 0) {
    out.push({
      title: "Investigate zero-result queries",
      detail: `${zero} directory searches returned no rows in the lookback window. Check taxonomy filters and index coverage.`,
      action: "eval_case",
    });
  }
  out.push({
    title: "Review pending provider enrichments",
    detail: "Approve contact/capability extractions so ranking can use richer signals.",
    href: "/admin/provider-enrichment",
    action: "review_enrichment",
  });
  out.push({
    title: "Add taxonomy aliases",
    detail: "For recurring low-confidence phrases, extend LEGAL_ISSUE_TAXONOMY aliases or vague-query rescue maps.",
    action: "taxonomy_alias",
  });
  out.push({
    title: "Document ranking overrides",
    detail: "Behavioural boosts read from search_ranking_signals (npm run search:signals). Tune caps in behavioural-boost.ts if one source dominates.",
    action: "provider_boost_doc",
  });
  return out;
}
