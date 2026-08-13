/**
 * Natural-language legal issue resolution.
 * Delegates to the advanced taxonomy resolver (question vs backdrop, excludes, conflicts).
 */

import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import { resolveTaxonomy } from "@/lib/legal/taxonomy-resolver";

export type NaturalLanguageIssueResolution = {
  taxonomySlug: string;
  canonicalName: string;
  matcherSlug: string;
  relatedPracticeAreas: string[];
  expandedTerms: string[];
  clarificationQuestion: string | null;
  searchBoostTerms: string[];
  legalAidLikely: boolean;
  matchStrength: number;
};

export function resolveLegalIssueFromNaturalLanguage(
  raw: string,
): NaturalLanguageIssueResolution | null {
  const resolved = resolveTaxonomy({ story: raw });
  if (!resolved) return null;
  return {
    taxonomySlug: resolved.taxonomySlug,
    canonicalName: resolved.canonicalName,
    matcherSlug: resolved.matcherSlug,
    relatedPracticeAreas: resolved.relatedPracticeAreas,
    expandedTerms: resolved.expandedTerms,
    clarificationQuestion: resolved.clarificationQuestion,
    searchBoostTerms: resolved.searchBoostTerms,
    legalAidLikely: resolved.legalAidLikely,
    matchStrength: resolved.matchStrength,
  };
}

export function allTaxonomySlugs(): string[] {
  return LEGAL_ISSUE_TAXONOMY.map((e) => e.slug);
}
