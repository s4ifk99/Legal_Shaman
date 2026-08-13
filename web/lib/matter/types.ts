/** Canonical matter understanding — shared contract for all downstream agents. */

export type MatterIssue = {
  slug: string;
  confidence: number;
  reason: string;
};

export type MatterParty = {
  id: string;
  role: string;
  label: string;
};

export type PartyCapacityKind =
  | "consumer"
  | "trader"
  | "employee"
  | "employer"
  | "tenant"
  | "landlord"
  | "company"
  | "agent"
  | "seller"
  | "buyer"
  | "owner"
  | "driver"
  | "unknown";

/** Capacity is event-scoped so employment backdrop does not contaminate a private sale. */
export type PartyCapacity = {
  partyId: string;
  capacity: PartyCapacityKind;
  appliesToEvents?: string[];
  confidence: number;
};

export type MatterRelationship = {
  partyA: string;
  partyB: string;
  type: string;
  appliesToEvents: string[];
  confidence: number;
};

export type MatterEvent = {
  id: string;
  type: string;
  /** Human-readable event summary. */
  description: string;
  /** Kept aligned with description for serialisation compat. */
  fact: string;
  dateApprox?: string;
  participants: string[];
  /** Relationship types active on this event (e.g. seller_buyer). */
  relationships: string[];
  /** Legal issue slugs this event supports — drives retrieval. */
  supportsIssues: string[];
  /** Operative dispute event vs backdrop (e.g. employment at work). */
  disputed?: boolean;
  confidence: number;
};

export type AmbiguityMateriality = "low" | "medium" | "high";

export type MatterAmbiguity = {
  question: string;
  whyItMatters: string;
  materiality: AmbiguityMateriality;
  affectsIssues?: string[];
  affectsRetrieval?: boolean;
  reason?: string;
  /** When true, matter gate should ask before researching/answering. */
  blocking?: boolean;
};

export type MatterJurisdiction = {
  code: string;
  confidence: number;
};

export type MatterResolutionStatus =
  | "resolved"
  | "partially_resolved"
  | "insufficient_facts"
  | "jurisdiction_uncertain"
  | "relationship_uncertain";

export type MatterProvenance = {
  briefAgent?: Record<string, unknown>;
  taxonomyAgent?: Record<string, unknown>;
  classifyAgent?: Record<string, unknown>;
  relationshipModel?: Record<string, unknown>;
  retrievalTraces?: unknown[];
};

export type MatterFrame = {
  matterId: string;
  jurisdiction?: MatterJurisdiction;
  primaryIssues: MatterIssue[];
  secondaryIssues: MatterIssue[];
  parties: MatterParty[];
  capacities: PartyCapacity[];
  relationships: MatterRelationship[];
  events: MatterEvent[];
  proceduralPosture?: string;
  objectives: string[];
  concepts: string[];
  exclusions: string[];
  ambiguities: MatterAmbiguity[];
  overallConfidence: number;
  resolutionStatus: MatterResolutionStatus;
  provenance: MatterProvenance;
  /** Retrieval scope labels derived from issues (domains / issue slugs). */
  retrievalScope: string[];
};

export type MatterResolveInput = {
  submission: string;
  clientQuestion?: string;
  understanding?: string;
  jurisdictionHint?: string;
  brief?: {
    understanding?: string;
    clientQuestion?: string;
    whatHappened?: string;
    goal?: string;
    mode?: string;
    parties?: { label?: string; role?: string }[];
    events?: { label?: string; rawSpan?: string; dateApprox?: string }[];
    openUncertainties?: { id?: string; whyItMatters?: string; suggestedAsk?: string }[];
  };
  classify?: {
    matterType?: string;
    topicId?: string;
    taxonomySlug?: string | null;
    taxonomyReason?: string | null;
  };
  taxonomy?: {
    taxonomySlug?: string | null;
    confidence?: string;
    reason?: string;
    candidates?: { slug: string; score: number; sources?: string[] }[];
  };
};

export type MatterDiagnostics = {
  resolvedAt: string;
  taxonomyConfidence: string | null;
  closeCall: boolean;
  candidateCount: number;
  legacyDetectorChanged?: boolean;
  disputeEventIds?: string[];
  relationshipCount?: number;
};

export type MatterResolveResult = {
  frame: MatterFrame;
  diagnostics: MatterDiagnostics;
};

export type MatterRetrievalHit = {
  id: string;
  title: string;
  category: string;
  score: number;
  intent?: string;
  /** Trace: which event/issue produced this intent. */
  trace?: string;
};

export type MatterEvidenceSet = {
  hits: MatterRetrievalHit[];
  intents: string[];
  mode: "baseline" | "matter-scoped";
  retrievalTraces?: import("./retrieval-plan").RetrievalIntentTrace[];
};

/** Matter understanding gate — separate from evidence sufficiency. */
export type MatterGateResult = {
  status: "pass" | "needs_clarification";
  reason?: string;
  blockingAmbiguities: string[];
};

/** Evidence sufficiency gate — separate from matter understanding. */
export type EvidenceGateResult = {
  status: "pass" | "retry" | "insufficient";
  issueCoverage: {
    issue: string;
    coverage: number;
    supported: boolean;
    evidenceIds: string[];
  }[];
  missingPropositions: string[];
  retryQueries: string[];
  contradictions: string[];
};

/** Required proposition for deterministic Evidence Gate. */
export type RequiredProposition = {
  id: string;
  issue: string;
  question: string;
  priority: "blocking" | "required" | "optional";
};

export type ResearchPlan = {
  retrievalScopes: string[];
  queries: string[];
  requiredPropositions: RequiredProposition[];
};

export type MatterResolutionDecision = {
  canProceed: boolean;
  needsClarification: boolean;
  clarificationQuestion?: string | null;
};

export type MatterResolutionConfidence = {
  matter: number;
  researchPlan: number;
};

export type HelpIntent = {
  practiceAreas: string[];
  freeHelpTypes: string[];
};

/** Output of frontier call #1 — matter_resolution. */
export type MatterResolutionResult = {
  agent: "matter_resolution";
  source: string;
  understanding: string;
  clientQuestion: string;
  decision: MatterResolutionDecision;
  confidence: MatterResolutionConfidence;
  matterFrame: Partial<MatterFrame>;
  researchPlan: ResearchPlan;
  helpIntent: HelpIntent;
  brief: MatterResolveInput["brief"] & Record<string, unknown>;
  taxonomy: MatterResolveInput["taxonomy"] & Record<string, unknown>;
  skipLegacyLlm?: boolean;
};
