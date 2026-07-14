import type { IntentConfidence } from "@/lib/legal-knowledge/search-intent";
import type { IssueClassification, LegalSearchSourceHit } from "@/lib/legal-knowledge/types";

export type LegalKnowledgeEvalTier = "unit" | "retrieval" | "integration" | "compiler";

export type LegalKnowledgeEvalCase = {
  id: string;
  query: string;
  tiers: LegalKnowledgeEvalTier[];

  // Intent / classification
  expectTaxonomySlug?: string;
  acceptableTaxonomySlugs?: string[];
  expectSpecificIssue?: string;
  expectIntentConfidence?: IntentConfidence;
  expectSuppressTerms?: string[];
  expectSemanticQueryContains?: string[];
  expectUrgency?: IssueClassification["urgency"];

  // Unit-only fixtures
  unitChunkScenario?: "filter_property_on_employment";
  unitUrlChecks?: Array<{ input: string; expected: string }>;

  // Guidance sources
  requiredSourceTermsAny?: string[];
  forbiddenSourceTitleTerms?: string[];
  forbiddenSourceTermsAny?: string[];
  minSources?: number;
  minConfidence?: number;
  maxConfidence?: number;
  requireAnswerTopic?: RegExp;
  forbidAnswerPhrases?: string[];

  // Directory (integration tier)
  requiredDirectoryTermsAny?: string[];
  forbiddenDirectoryTerms?: string[];
  minRelevantDirectoryInTopK?: number;
  directoryTopK?: number;
  requireDirectory?: boolean;

  requireCitation?: boolean;
  notes?: string;
};

export type GradedSource = LegalSearchSourceHit & {
  rank: number;
  relevant: boolean;
  relevanceReasons: string[];
  haystack: string;
};

export type GradedDirectoryResult = {
  rank: number;
  id: string;
  title: string;
  explanation?: string;
  relevant: boolean;
  relevanceReasons: string[];
  haystack: string;
};

export type LegalKnowledgeEvalCaseResult = {
  caseId: string;
  query: string;
  tier: LegalKnowledgeEvalTier;
  passed: boolean;
  failures: string[];
  notes?: string;

  taxonomySlug?: string | null;
  taxonomyAccurate?: boolean;
  specificIssue?: string | null;
  intentConfidence?: IntentConfidence;
  sourcePrecisionAt3?: number;
  directoryPrecisionAtK?: number;
  relevantSourcesInTop3?: number;
  relevantDirectoryInTopK?: number;
  confidence?: number;
  sourceCount?: number;
  directoryCount?: number;
  answerSafetyPass?: boolean;
  intentSignals?: string[];
  answerMode?: string;
  pagePrecisionAt3?: number;
  graphClusterSize?: number;
};

export type LegalKnowledgeEvalAggregateMetrics = {
  caseCount: number;
  passedCount: number;
  failedCount: number;
  intentTaxonomyAccuracy: number;
  sourcePrecisionAt3: number;
  directoryPrecisionAtK: number;
  forbiddenViolationRate: number;
  answerSafetyPassRate: number;
  passCriteriaMet: boolean;
};

export type LegalKnowledgeEvalReport = {
  generatedAt: string;
  tier: LegalKnowledgeEvalTier | "all";
  aggregate: LegalKnowledgeEvalAggregateMetrics;
  passCriteria: {
    intentTaxonomyAccuracyMin: number;
    sourcePrecisionAt3Min: number;
    directoryPrecisionAtKMin: number;
    forbiddenViolationRateMax: number;
    answerSafetyPassRateMin: number;
  };
  results: LegalKnowledgeEvalCaseResult[];
};
