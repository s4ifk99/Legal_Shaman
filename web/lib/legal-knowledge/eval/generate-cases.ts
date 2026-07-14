import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import { formatLegalKnowledgeEvalCaseSnippet } from "@/lib/search-quality/eval-integration";

import type { LegalKnowledgeEvalCase, LegalKnowledgeEvalTier } from "./types";

const CONFUSION_PAIRS: Array<{
  id: string;
  query: string;
  expectTaxonomySlug: string;
  acceptableTaxonomySlugs?: string[];
  forbiddenSourceTitleTerms?: string[];
  forbiddenDirectoryTerms?: string[];
  notes: string;
}> = [
  {
    id: "confusion_employer_commission_company",
    query: "my employer owes commission and the company name is on my contract",
    expectTaxonomySlug: "employment",
    forbiddenSourceTitleTerms: ["Property", "Planning"],
    forbiddenDirectoryTerms: ["planning", "personal injury"],
    notes: "employer + commission + company — must not drift to property/planning directory",
  },
  {
    id: "confusion_paid_benefits",
    query: "I have not been paid my universal credit and my employer withheld wages",
    expectTaxonomySlug: "welfare_benefits",
    acceptableTaxonomySlugs: ["employment"],
    notes: "paid + benefits cross-contamination",
  },
  {
    id: "confusion_deposit_landlord",
    query: "landlord kept my deposit and I need housing advice",
    expectTaxonomySlug: "housing",
    forbiddenSourceTitleTerms: ["Employment", "Consumer"],
    notes: "deposit + landlord — not employment/consumer",
  },
  {
    id: "confusion_arrested_police",
    query: "I was arrested by police and need a criminal solicitor",
    expectTaxonomySlug: "criminal_defence",
    forbiddenSourceTitleTerms: ["Family", "Immigration"],
    forbiddenDirectoryTerms: ["family", "immigration"],
    notes: "arrested + police — not family/immigration",
  },
];

function slugFromPhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

function buildTaxonomyPhraseCases(): LegalKnowledgeEvalCase[] {
  const cases: LegalKnowledgeEvalCase[] = [];
  for (const entry of LEGAL_ISSUE_TAXONOMY) {
    const phrases = entry.userPhrases.filter((p) => p.length >= 8).slice(0, 2);
    for (const phrase of phrases) {
      cases.push({
        id: `generated_taxonomy_${entry.slug}_${slugFromPhrase(phrase)}`,
        query: phrase,
        tiers: ["unit"],
        expectTaxonomySlug: entry.slug,
        notes: `Generated from taxonomy userPhrase for ${entry.slug}`,
      });
    }
  }
  return cases;
}

function buildSubIssueCases(): LegalKnowledgeEvalCase[] {
  const cases: LegalKnowledgeEvalCase[] = [];
  for (const entry of LEGAL_ISSUE_TAXONOMY) {
    if (!entry.subIssueRules?.length) continue;
    for (const rule of entry.subIssueRules.slice(0, 2)) {
      const terms = [...(rule.allTerms ?? []), rule.anyTerms[0]].filter(Boolean);
      if (!terms.length) continue;
      const query = `help with ${terms.join(" ")}`;
      cases.push({
        id: `generated_subissue_${entry.slug}_${slugFromPhrase(rule.label)}`,
        query,
        tiers: ["unit"],
        expectTaxonomySlug: entry.slug,
        expectSpecificIssue: rule.label,
        notes: `Generated from subIssueRule "${rule.label}" on ${entry.slug}`,
      });
    }
  }
  return cases;
}

function buildConfusionCases(): LegalKnowledgeEvalCase[] {
  return CONFUSION_PAIRS.map((pair) => ({
    id: pair.id,
    query: pair.query,
    tiers: ["unit", "retrieval"] as LegalKnowledgeEvalTier[],
    expectTaxonomySlug: pair.expectTaxonomySlug,
    acceptableTaxonomySlugs: pair.acceptableTaxonomySlugs,
    forbiddenSourceTitleTerms: pair.forbiddenSourceTitleTerms,
    forbiddenDirectoryTerms: pair.forbiddenDirectoryTerms,
    notes: pair.notes,
  }));
}

export function generateLegalKnowledgeEvalCases(): LegalKnowledgeEvalCase[] {
  return [
    ...buildTaxonomyPhraseCases(),
    ...buildSubIssueCases(),
    ...buildConfusionCases(),
  ];
}

export function formatGeneratedCaseSnippets(cases: LegalKnowledgeEvalCase[]): string {
  const lines: string[] = [
    "// Suggested cases — review and merge into lib/legal-knowledge/eval/cases.ts",
    "",
  ];
  for (const c of cases) {
    lines.push(formatLegalKnowledgeEvalCaseSnippet(c));
    lines.push("");
  }
  return lines.join("\n");
}

/** CLI entry: prints generated case snippets to stdout. */
export function printGeneratedCases(): void {
  const generated = generateLegalKnowledgeEvalCases();
  console.log(formatGeneratedCaseSnippets(generated));
  console.log(`// Total suggested: ${generated.length}`);
}
