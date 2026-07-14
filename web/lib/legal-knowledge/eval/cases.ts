import type { LegalKnowledgeEvalCase } from "./types";
import { COMMISSION_QUERY } from "./fixtures/chunks";

function L(
  partial: Partial<LegalKnowledgeEvalCase> & Pick<LegalKnowledgeEvalCase, "id" | "query">,
): LegalKnowledgeEvalCase {
  return {
    tiers: ["unit", "retrieval", "integration"],
    minSources: 0,
    ...partial,
  };
}

/** Curated eval cases — hand-maintained regressions plus adversarial traps. */
export const LEGAL_KNOWLEDGE_EVAL_CASES: LegalKnowledgeEvalCase[] = [
  L({
    id: "unfair_dismissal",
    query: "I was unfairly dismissed from my job",
    expectTaxonomySlug: "employment",
  }),
  L({
    id: "housing_disrepair",
    query: "my landlord won't fix damp and mould",
    expectTaxonomySlug: "housing",
  }),
  L({
    id: "deposit_not_returned",
    query: "my landlord won't return my deposit",
    expectTaxonomySlug: "housing",
    expectSpecificIssue: "deposit",
    requiredSourceTermsAny: ["deposit", "tenancy", "landlord"],
    forbiddenSourceTitleTerms: ["Employment", "Immigration"],
  }),
  L({
    id: "housing_deposit",
    query: "landlord kept my tenancy deposit after I moved out",
    expectTaxonomySlug: "housing",
    expectSpecificIssue: "deposit",
    requiredSourceTermsAny: ["deposit", "tenancy"],
    forbiddenSourceTitleTerms: ["Employment", "Consumer"],
    forbiddenDirectoryTerms: ["planning", "personal injury"],
    directoryTopK: 6,
    minRelevantDirectoryInTopK: 0,
  }),
  L({
    id: "domestic_abuse_emergency",
    query: "I need to leave home tonight because of domestic abuse",
    expectTaxonomySlug: "family",
    expectUrgency: "emergency",
  }),
  L({
    id: "immigration_visa_refusal",
    query: "my visa application was refused",
    expectTaxonomySlug: "immigration",
  }),
  L({
    id: "debt_claim",
    query: "I have a debt claim and bailiffs are involved",
    expectTaxonomySlug: "debt",
  }),
  L({
    id: "small_claims",
    query: "how do I take someone to small claims court",
    expectTaxonomySlug: "consumer_small_claims",
    acceptableTaxonomySlugs: ["consumer"],
  }),
  L({
    id: "prison_law",
    query: "I need help with recall to prison",
    expectTaxonomySlug: "prison_law",
  }),
  L({
    id: "family_child_contact",
    query: "I need help with child contact arrangements",
    expectTaxonomySlug: "family",
  }),
  L({
    id: "family_prenup",
    query: "I need a prenup before we get married",
    expectTaxonomySlug: "family",
    expectSpecificIssue: "prenuptial",
    requiredSourceTermsAny: ["prenuptial", "prenup", "cohabitation", "marriage"],
  }),
  L({
    id: "family_cohabitation",
    query: "cohabitation agreement with my partner",
    expectTaxonomySlug: "family",
    expectSpecificIssue: "cohabitation",
  }),
  L({
    id: "pregnancy_discrimination",
    query: "I was dismissed while pregnant",
    expectTaxonomySlug: "employment",
  }),
  L({
    id: "employment_commission",
    query: COMMISSION_QUERY,
    expectTaxonomySlug: "employment",
    expectSpecificIssue: "unpaid commission",
    expectSuppressTerms: ["company"],
    expectSemanticQueryContains: ["commission", "employment"],
    unitChunkScenario: "filter_property_on_employment",
    forbiddenSourceTitleTerms: ["Property", "Police and crime", "Divorce"],
    requiredSourceTermsAny: ["employment", "commission", "wage", "acas"],
    requiredDirectoryTermsAny: ["employment"],
    forbiddenDirectoryTerms: ["planning", "personal injury"],
    forbiddenSourceTermsAny: ["property law"],
    minConfidence: 0.2,
    requireDirectory: true,
    directoryTopK: 6,
    requireAnswerTopic: /employment|commission|wage|acas/i,
    notes: "Template case — full assertions across unit, retrieval, and integration tiers",
  }),
  L({
    id: "employment_unpaid_wages",
    query: "my employer has not paid my wages for two months",
    expectTaxonomySlug: "employment",
    expectSpecificIssue: "unpaid wages",
    requiredSourceTermsAny: ["wage", "pay", "employment", "acas"],
    forbiddenSourceTitleTerms: ["Property", "Immigration"],
  }),
  L({
    id: "benefits_vs_employment_paid",
    query: "I have not been paid and my employer says I am not entitled to benefits",
    expectTaxonomySlug: "employment",
    acceptableTaxonomySlugs: ["welfare_benefits"],
    forbiddenSourceTitleTerms: ["Property", "Planning"],
    notes: "Cross-area confusion: unpaid pay from employer vs UC",
  }),
  L({
    id: "directory_company_noise",
    query: COMMISSION_QUERY,
    tiers: ["integration"],
    expectTaxonomySlug: "employment",
    forbiddenDirectoryTerms: ["planning", "personal injury"],
    requireDirectory: true,
    directoryTopK: 8,
    notes: "Directory suppressTerms regression — firm names containing COMPANY",
  }),
  L({
    id: "wiki_index_page_reject",
    query: "my boss has not paid my commission",
    tiers: ["unit", "retrieval"],
    expectTaxonomySlug: "employment",
    unitChunkScenario: "filter_property_on_employment",
    forbiddenSourceTitleTerms: ["Property"],
    notes: "Property wiki index pages must not pass employment intent filter",
  }),
  L({
    id: "criminal_vs_family_trap",
    query: "I was arrested by police and need a solicitor",
    expectTaxonomySlug: "criminal_defence",
    forbiddenSourceTitleTerms: ["Family", "Immigration"],
    forbiddenDirectoryTerms: ["family law", "immigration"],
  }),
  L({
    id: "deposit_vs_employment_trap",
    query: "my landlord will not return my deposit and my employer owes commission",
    expectTaxonomySlug: "housing",
    acceptableTaxonomySlugs: ["employment"],
    notes: "Adversarial: deposit + employer — housing or employment acceptable",
  }),
  L({
    id: "url_normalize_wiki",
    query: "employment rights",
    tiers: ["unit"],
    unitUrlChecks: [
      { input: "/wiki/Areas%2FEmployment", expected: "/ask-the-shaman/wiki/Areas%2FEmployment" },
      {
        input: "https://legalshaman.com/wiki/Areas%2FProperty",
        expected: "/ask-the-shaman/wiki/Areas%2FProperty",
      },
    ],
  }),
  L({
    id: "low_confidence_clarify",
    query: "I need help with something at work",
    tiers: ["integration"],
    expectTaxonomySlug: "employment",
    maxConfidence: 0.85,
    notes: "Clarifying question should mention identified area when intent is known",
  }),
];

export function casesForTier(
  tier: LegalKnowledgeEvalTier,
  cases: LegalKnowledgeEvalCase[] = LEGAL_KNOWLEDGE_EVAL_CASES,
): LegalKnowledgeEvalCase[] {
  return cases.filter((c) => c.tiers.includes(tier));
}
