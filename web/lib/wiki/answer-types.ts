import type { WikiSearchHit } from "./search";

export type WikiAnswerSource = {
  name: string;
  detail?: string;
};

export type WikiAnswerFirm = {
  firm: string;
  practiceArea: string;
  articleCount: number;
  directoryUrl: string;
  entityId?: string;
  resultSource?: "sra" | "curated_listing" | "legal_aid";
};

export type WikiAnswerPayload = {
  query: string;
  mode: "synthesis" | "retrieval_only" | "insufficient";
  answer: string | null;
  wikiPages: WikiSearchHit[];
  sources: WikiAnswerSource[];
  recommendedFirms: WikiAnswerFirm[];
  disclaimer: string;
  retrievalScore: number;
  message?: string;
  latencyMs?: number;
  /** How the final answer was produced — for satnav training logs. */
  synthesisMeta?: {
    used: "llm" | "deterministic" | "none";
    deterministicAnswer?: string;
    llmAnswer?: string;
    llmError?: string;
  };
};

export const WIKI_ANSWER_DISCLAIMER =
  "Signposting only — not legal advice. This summary is drawn from indexed public guidance. For personalised help, contact Citizens Advice or use Find a Lawyer.";
