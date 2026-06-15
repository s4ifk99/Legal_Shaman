import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

export function practiceAreasFromText(
  text: string,
  options?: { includeRelated?: boolean },
): string[] {
  const res = resolveLegalIssueFromQuery(text);
  if (!res) return [];
  const includeRelated = options?.includeRelated !== false;
  const areas = new Set<string>([res.canonicalName]);
  if (includeRelated) {
    for (const r of res.relatedPracticeAreas) areas.add(r);
  }
  return [...areas];
}

export function subIssuesFromSlug(slug: string | null): string[] {
  if (!slug) return [];
  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === slug);
  return entry?.subIssues ?? [];
}
