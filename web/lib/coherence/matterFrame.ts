/** Serializable MatterFrame subset stored on session / API responses. */
export type SessionMatterFrame = {
  matterId: string;
  resolutionStatus: string;
  primaryIssues: { slug: string; confidence: number; reason: string }[];
  secondaryIssues: { slug: string; confidence: number; reason: string }[];
  exclusions: string[];
  ambiguities: {
    question: string;
    whyItMatters: string;
    materiality: string;
    blocking?: boolean;
    affectsIssues?: string[];
    affectsRetrieval?: boolean;
  }[];
  events: {
    id: string;
    type: string;
    description: string;
    supportsIssues: string[];
    disputed?: boolean;
  }[];
  relationships: {
    partyA: string;
    partyB: string;
    type: string;
    appliesToEvents: string[];
    confidence: number;
  }[];
  capacities: {
    partyId: string;
    capacity: string;
    appliesToEvents?: string[];
    confidence: number;
  }[];
  retrievalScope: string[];
  overallConfidence: number;
};

export function toSessionMatterFrame(
  frame: import("@/lib/matter/types").MatterFrame,
): SessionMatterFrame {
  return {
    matterId: frame.matterId,
    resolutionStatus: frame.resolutionStatus,
    primaryIssues: frame.primaryIssues,
    secondaryIssues: frame.secondaryIssues,
    exclusions: frame.exclusions,
    ambiguities: frame.ambiguities,
    relationships: frame.relationships,
    capacities: frame.capacities,
    events: frame.events.map((e) => ({
      id: e.id,
      type: e.type,
      description: e.description,
      supportsIssues: e.supportsIssues,
      disputed: e.disputed,
    })),
    retrievalScope: frame.retrievalScope,
    overallConfidence: frame.overallConfidence,
  };
}
