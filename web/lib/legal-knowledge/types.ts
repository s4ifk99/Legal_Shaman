import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";

export type LegalKnowledgeSource = {
  domain: string;
  name: string;
  authorityWeight: number;
  jurisdiction?: string;
};

export type ChunkMetadata = {
  documentId: string;
  sourceUrl: string;
  title: string;
  heading: string | null;
  chunkText: string;
  chunkIndex: number;
  tokenCount: number;
  domain: string;
  sourceName: string;
  authorityWeight: number;
  fetchedAt: Date;
  sourceUpdatedAt: Date | null;
};

export type RetrievedChunk = ChunkMetadata & {
  id: string;
  snippet: string;
  relevanceScore: number;
  authorityScore: number;
  freshnessScore: number;
  lexicalScore: number;
  vectorScore: number;
  phraseScore: number;
  finalScore: number;
};

export type IssueClassification = {
  area: string;
  subArea: string;
  /** More specific label when detected, e.g. "deposit dispute". */
  specificIssue?: string;
  urgency: "low" | "medium" | "high" | "emergency";
};

export type SearchCriterionKind =
  | "legal_issue"
  | "situation"
  | "jurisdiction"
  | "location"
  | "urgency"
  | "help_route"
  | "sources"
  | "retrieval";

export type SearchCriterion = {
  id: string;
  kind: SearchCriterionKind;
  label: string;
  text: string;
  emphasis?: "high" | "normal";
};

export type LegalSearchSourceHit = {
  title: string;
  url: string;
  source: string;
  snippet: string;
  score: number;
  heading?: string | null;
};

export type LegalSearchRequest = {
  query: string;
  location?: string;
  jurisdiction?: string;
  includeDirectory?: boolean;
};

export type LegalSearchResponse = {
  answerType: "legal_information";
  confidence: number;
  issueClassification: IssueClassification;
  sources: LegalSearchSourceHit[];
  directoryResults: Array<{
    id: string;
    title: string;
    source: string;
    url?: string;
    locationLabel?: string;
    explanation?: string;
    score: number;
  }>;
  /** Full directory rows for expandable detail UI (same order as directoryResults). */
  directoryRows?: LegacyGetRow[];
  suggestedNextSteps: string[];
  clarifyingQuestion: string | null;
  answer: string | null;
  disclaimer: string;
  answerMode?: "synthesis" | "fallback" | "graph_assembly";
  searchCriteria: SearchCriterion[];
  debug?: {
    retrievalCount: number;
    rerankedCount: number;
    mode: "hybrid" | "lexical_only" | "empty" | "graph" | "wiki";
    intentSignals?: string[];
    conceptCluster?: string[];
    classificationFusion?: {
      fusionSource: string;
      ruleTaxonomySlug?: string;
      llmTaxonomySlug?: string;
      ruleMatchStrength?: number;
      llmConfidence?: number;
      phraseCandidates?: string[];
    };
    graphShadow?: {
      graphAvailable?: boolean;
      graphConfidence?: number;
      graphAnswerPreview?: string;
      ragAnswerMode?: string;
      conceptCluster?: string[];
      /** @deprecated use graphAnswerPreview */
      ragAnswerPreview?: string;
      /** @deprecated use graphAvailable */
      graphUsed?: boolean;
    };
  };
};

export const LEGAL_SEARCH_DISCLAIMER =
  "Signposting and legal information only — not legal advice. Verify important details with the cited sources or a qualified adviser.";
