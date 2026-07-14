import {
  LEGAL_ISSUE_TAXONOMY,
  type LegalIssueTaxonomyEntry,
  type SubIssueRule,
} from "@/lib/legal/legal-issue-taxonomy-data";

function queryMatchesRule(lower: string, rule: SubIssueRule): boolean {
  if (rule.excludeTerms?.some((t) => lower.includes(t.toLowerCase()))) return false;
  if (rule.allTerms?.length) {
    if (!rule.allTerms.every((t) => lower.includes(t.toLowerCase()))) return false;
  }
  if (!rule.anyTerms.some((t) => lower.includes(t.toLowerCase()))) return false;
  return true;
}

/** Infer a specific sub-issue label from taxonomy rules for a slug. */
export function inferSubIssueFromTaxonomy(query: string, taxonomySlug: string): string | null {
  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === taxonomySlug);
  if (!entry?.subIssueRules?.length) return null;
  const lower = query.toLowerCase();
  for (const rule of entry.subIssueRules) {
    if (queryMatchesRule(lower, rule)) return rule.label;
  }
  return null;
}

/** First matching sub-issue across all taxonomy entries (when slug unknown). */
export function inferSubIssueFromQuery(query: string): string | null {
  const lower = query.toLowerCase();
  for (const entry of LEGAL_ISSUE_TAXONOMY) {
    if (!entry.subIssueRules?.length) continue;
    for (const rule of entry.subIssueRules) {
      if (queryMatchesRule(lower, rule)) return rule.label;
    }
  }
  return null;
}

export function subIssueRulesForEntry(entry: LegalIssueTaxonomyEntry): SubIssueRule[] {
  return entry.subIssueRules ?? [];
}
