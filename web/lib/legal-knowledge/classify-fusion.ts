import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import type { LegalIssueResolution } from "@/lib/legal/taxonomy";
import { matcherSlugForTaxonomySlug } from "@/lib/legal/taxonomy";

import type { IntentConfidence } from "./search-intent";
import {
  LLM_CLASSIFY_ACCEPT_THRESHOLD,
  legalClassifyRuleStrongThreshold,
} from "./classify-config";
import type { LlmLegalClassification } from "./classify-llm";

export type FusionSource = "rules" | "llm" | "agreed";

export type ClassificationFusion = {
  taxonomySlug?: string;
  matcherSlug?: string;
  canonicalName?: string;
  specificIssue?: string;
  semanticQuery?: string;
  searchBoostTerms: string[];
  confidence: IntentConfidence;
  fusionSource: FusionSource;
  clarifyingQuestion?: string;
  ruleTaxonomySlug?: string;
  ruleMatchStrength: number;
  llmTaxonomySlug?: string;
  llmConfidence?: number;
  phraseCandidates: string[];
};

const GENERIC_TOKENS = new Set([
  "need",
  "help",
  "want",
  "looking",
  "legal",
  "lawyer",
  "solicitor",
  "advice",
  "about",
  "with",
  "have",
  "getting",
]);

function phraseCandidatesFromQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t))
    .slice(0, 8);
}

function intentConfidenceFromStrength(strength: number): IntentConfidence {
  if (strength >= 0.28) return "high";
  if (strength >= 0.12) return "medium";
  return "low";
}

/** Merge rule-based resolution with optional LLM classification. */
export function fuseRuleAndLlmClassification(args: {
  query: string;
  ruleResolution: LegalIssueResolution | null;
  llm: LlmLegalClassification | null;
}): ClassificationFusion {
  const { query, ruleResolution, llm } = args;
  const threshold = legalClassifyRuleStrongThreshold();
  const ruleStrong =
    ruleResolution != null && ruleResolution.matchStrength >= threshold;
  const ruleSlug = ruleResolution?.taxonomySlug;
  const llmSlug = llm?.taxonomySlug;
  const llmStrong = llm != null && llm.confidence >= LLM_CLASSIFY_ACCEPT_THRESHOLD;

  let fusionSource: FusionSource = "rules";
  let taxonomySlug: string | undefined = ruleSlug;
  let specificIssue = llm?.specificIssue;
  let confidence: IntentConfidence = intentConfidenceFromStrength(
    ruleResolution?.matchStrength ?? 0,
  );
  let clarifyingQuestion = llm?.clarifyingQuestion;

  if (ruleStrong && llmSlug && ruleSlug === llmSlug) {
    fusionSource = "agreed";
    taxonomySlug = ruleSlug;
    specificIssue = llm.specificIssue ?? specificIssue;
    confidence = "high";
  } else if (ruleStrong) {
    fusionSource = "rules";
    taxonomySlug = ruleSlug;
    confidence = intentConfidenceFromStrength(ruleResolution!.matchStrength);
  } else if (llmStrong && llmSlug) {
    fusionSource = "llm";
    taxonomySlug = llmSlug;
    specificIssue = llm.specificIssue ?? specificIssue;
    confidence =
      llm.confidence >= 0.75 ? "high" : llm.confidence >= 0.55 ? "medium" : "low";
    clarifyingQuestion = llm.clarifyingQuestion;
  } else if (!ruleStrong && llmSlug && (llm?.confidence ?? 0) >= 0.4) {
    // Prefer a specific LLM label over a weak/empty rule path that becomes "general".
    fusionSource = "llm";
    taxonomySlug = llmSlug;
    specificIssue = llm?.specificIssue ?? specificIssue;
    confidence =
      (llm?.confidence ?? 0) >= 0.75 ? "high" : (llm?.confidence ?? 0) >= 0.55 ? "medium" : "low";
    clarifyingQuestion = llm?.clarifyingQuestion;
  } else if (ruleSlug && llmSlug && ruleSlug !== llmSlug) {
    const ruleScore = ruleResolution?.matchStrength ?? 0;
    const llmScore = llm?.confidence ?? 0;
    if (llmScore > ruleScore && llmScore >= 0.4) {
      fusionSource = "llm";
      taxonomySlug = llmSlug;
      specificIssue = llm?.specificIssue;
      confidence = llmScore >= 0.75 ? "high" : "medium";
    } else {
      fusionSource = "rules";
      taxonomySlug = ruleSlug;
    }
  } else {
    taxonomySlug = ruleSlug ?? llmSlug;
    if (!taxonomySlug) confidence = "low";
  }

  const entry = taxonomySlug
    ? LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === taxonomySlug)
    : undefined;

  const searchBoostTerms = [
    ...(ruleResolution?.searchBoostTerms ?? []),
    ...(entry?.searchBoostTerms ?? []),
    ...(llm?.searchBoostTerms ?? []),
    ...(specificIssue ? [specificIssue] : []),
  ];

  const phraseCandidates =
    fusionSource === "llm" && !ruleStrong
      ? phraseCandidatesFromQuery(query)
      : ruleSlug && llmSlug && ruleSlug !== llmSlug
        ? phraseCandidatesFromQuery(query)
        : [];

  return {
    taxonomySlug,
    matcherSlug: taxonomySlug ? matcherSlugForTaxonomySlug(taxonomySlug) ?? undefined : undefined,
    canonicalName: entry?.canonicalName ?? ruleResolution?.canonicalName,
    specificIssue,
    semanticQuery: llm?.semanticQuery,
    searchBoostTerms: [...new Set(searchBoostTerms.map((t) => t.toLowerCase()))].slice(0, 16),
    confidence,
    fusionSource,
    clarifyingQuestion,
    ruleTaxonomySlug: ruleSlug,
    ruleMatchStrength: ruleResolution?.matchStrength ?? 0,
    llmTaxonomySlug: llmSlug,
    llmConfidence: llm?.confidence,
    phraseCandidates,
  };
}
