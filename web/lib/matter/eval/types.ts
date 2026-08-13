export type MatterEvalSuite = "regression" | "coverage" | "adversarial";

export type MatterEvalExpectation = {
  primaryIssuesAny: string[];
  secondaryIssuesAny?: string[];
  mustExclude?: string[];
  mustRetrieveConcepts?: string[];
  mustNotRetrieveDomains?: string[];
  helpMatchPracticeAny?: string[];
  expectLowConfidence?: boolean;
  expectAmbiguities?: boolean;
  /** Empty primary is OK when resolutionStatus matches. */
  allowEmptyPrimary?: boolean;
  resolutionStatusAny?: string[];
  mustRelationshipTypes?: string[];
};

export type MatterEvalCase = {
  id: string;
  label: string;
  suite: MatterEvalSuite;
  submission: string;
  expected: MatterEvalExpectation;
};

export type MatterEvalLayerScores = {
  matterPrimary: number;
  matterSecondary: number;
  matterExclusions: number;
  matterAmbiguity: number;
  retrievalPrecision: number;
  retrievalRecall: number;
  helpMatchAlignment: number;
};

export type MatterEvalCaseResult = {
  id: string;
  label: string;
  suite: MatterEvalSuite;
  matterPrimarySlugs: string[];
  matterSecondarySlugs: string[];
  matterExclusions: string[];
  resolutionStatus?: string;
  relationshipTypes?: string[];
  retrievalTitles: string[];
  retrievalMode: "baseline" | "matter-scoped";
  scores: MatterEvalLayerScores;
  failures: string[];
  pass: boolean;
};

export type MatterEvalReport = {
  mode: "baseline" | "matter-scoped";
  cases: MatterEvalCaseResult[];
  averages: MatterEvalLayerScores;
  passCount: number;
  total: number;
  bySuite: Record<MatterEvalSuite, { passCount: number; total: number }>;
};
