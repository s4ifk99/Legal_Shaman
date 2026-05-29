import type { LegalIssueTaxonomyEntry } from "@/lib/legal/legal-issue-taxonomy-data";

export type RefinementChip = {
  id: string;
  label: string;
  value: string;
};

/** Sub-issues or parsed clarification options for directory refinement chips. */
export function narrowHintsFromTaxonomyEntry(entry: LegalIssueTaxonomyEntry): string[] {
  if (entry.subIssues.length > 0) {
    return entry.subIssues.slice(0, 6);
  }
  const q = entry.clarificationQuestions[0];
  if (!q) return [];
  return q
    .replace(/^Is this about\s+/i, "")
    .replace(/\?$/, "")
    .split(/,|\bor\b/i)
    .map((s) => s.trim().replace(/^a\s+/i, ""))
    .filter((s) => s.length > 2)
    .slice(0, 6);
}

export function refinementChipsFromHints(hints: string[]): RefinementChip[] {
  return hints.map((hint) => {
    const value = hint.trim();
    const id =
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "") || "chip";
    return { id, label: value, value };
  });
}

export function refinementChipsFromEntry(entry: LegalIssueTaxonomyEntry): RefinementChip[] {
  return refinementChipsFromHints(narrowHintsFromTaxonomyEntry(entry));
}

/** Append a refinement chip to the user's search query (deduped). */
export function mergeRefinedSearchQuery(baseQuery: string, chipValue: string): string {
  const base = baseQuery.trim();
  const chip = chipValue.trim();
  if (!chip) return base;
  if (!base) return chip;
  if (base.toLowerCase().includes(chip.toLowerCase())) return base;
  return `${base} ${chip}`.trim();
}
