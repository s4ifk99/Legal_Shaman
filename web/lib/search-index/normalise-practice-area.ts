import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

export function practiceAreasFromText(text: string): string[] {
  const res = resolveLegalIssueFromQuery(text);
  if (!res) return [];
  const areas = new Set<string>([res.canonicalName, ...res.relatedPracticeAreas]);
  return [...areas];
}

export function subIssuesFromSlug(slug: string | null): string[] {
  if (!slug) return [];
  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === slug);
  return entry?.subIssues ?? [];
}
