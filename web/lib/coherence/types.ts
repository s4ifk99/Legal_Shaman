import type { SessionMatterFrame } from './matterFrame'
import type { ResearchBundle } from './researchBundle'

export type QuestionKind = 'open' | 'closed'

export interface PredictiveChoice {
  id: string
  label: string
  value: string
}

export interface Prompt {
  id: string
  text: string
  kind: QuestionKind
  /** Why this question is being asked (causation gap reasoning) */
  reason?: string
  options?: PredictiveChoice[]
}

export type MatterType =
  | 'immigration'
  | 'personal_injury'
  | 'housing'
  | 'conveyancing'
  | 'employment'
  | 'family'
  | 'debt'
  | 'consumer'
  | 'crime'
  | 'other'
  | 'unknown'

export type Jurisdiction = 'EnglandWales' | 'Scotland' | 'NorthernIreland' | 'Unknown'

export type Mode = 'browse' | 'dispute' | 'info' | 'research' | 'urgent' | 'unknown'
export type SearchMode = 'umbra' | 'penumbra'
export type PenumbraResearchStatus = 'idle' | 'starting' | 'awaiting_input' | 'complete' | 'error'

export interface TimelineEvent {
  id: string
  label: string
  rawSpan?: string
  dateApprox?: string
  kind: 'start' | 'event' | 'goal'
}

export interface Party {
  label: string
  role?: string
}

export interface SessionState {
  rawInputs: string[]
  events: TimelineEvent[]
  whatHappened: string
  howCaused: string
  goal: string
  parties: Party[]
  documents: string[]
  matterType: MatterType
  jurisdiction: Jurisdiction
  locationHint: string
  mode: Mode
  /** Retrieval breadth preference; hard safety and grounding checks apply in both modes. */
  searchMode: SearchMode
  penumbraAcknowledged: boolean
  /** Separate, optional exploratory child session; never the canonical case answer. */
  penumbraResearch?: {
    status: PenumbraResearchStatus
    caseKey: string
    conversationId?: string
    questions: string[]
    bundle?: ResearchBundle
    fallback?: boolean
    error?: string
    updatedAt: string
    cacheHit?: boolean
    exaSource?: string
  }
  softFlags: string[]
  safetyRisk: boolean
  answeredPromptIds: string[]
  /** Brief Agent: short understanding of the live dispute */
  briefUnderstanding?: string
  /** Brief Agent: client's question in their words */
  clientQuestion?: string
  /** Brief Agent topic id (e.g. housing-access, consumer-car) */
  topicId?: string
  /** Taxonomy slug from Classify / TaxonomyAgent */
  taxonomySlug?: string | null
  /** Canonical matter understanding — downstream agents must not re-classify raw prose */
  matterFrame?: SessionMatterFrame | null
  /** User-confirmed reformulated search question (Atwell-style expert arm). */
  confirmedSearchQuery: string
  /** none = not yet gated; confirmed = used reformulation; refused = safety refuse; skipped = original words */
  reformulationOutcome: 'none' | 'confirmed' | 'refused' | 'skipped'
  /** Chen-style formal retrieval query (glossary ± LLM). */
  styleTranslatedQuery: string
  /** CAQI-style context tokens, e.g. jurisdiction:EnglandWales role:tenant */
  searchContextTokens: string[]
  /** Shao-adapted lay search intent */
  searchIntent:
    | 'particular_resource'
    | 'characterization'
    | 'remedy_outcome'
    | 'procedure'
    | 'interest_browse'
    | 'unknown'
  /** Primary online metric for AB success under this intent */
  abPrimaryMetric:
    | 'precision_at_k'
    | 'frame_confirm_rate'
    | 'task_completion'
    | 'guidance_step_engagement'
    | 'session_depth'
    | 'unset'
  /**
   * User-confirmed CAQI role (employment clarify). unset = infer from narrative.
   */
  confirmedUserRole:
    | 'tenant'
    | 'landlord'
    | 'employee'
    | 'employer'
    | 'consumer'
    | 'immigrant_applicant'
    | 'family_member'
    | 'unset'
  /** Sargeant-style UK taxonomy hit (L1/L2 + matter pack). */
  ukTaxonomyL1: string
  ukTaxonomyL2: string
  ukTaxonomyPackId: string
  ukTaxonomyConfidence: number
  /** T5: answers from authority interrogator (topic:/goal:/…). */
  authorityAnswers: string[]
  /** T5: offline allowlisted authority pages (no Exa in product). */
  authorityHits: Array<{
    id: string
    title: string
    url: string
    tier: string
    score: number
    firm?: string
    kind?: 'official' | 'law_firm'
  }>
  /** T5: citation audit passed on authorityHits. */
  authorityAuditOk: boolean
  /** OpenRouter / heuristic pack classifier result (first-message intent). */
  packClassification?: {
    packId: string
    confidence: number
    reason: string
    clarifyingQuestion?: string
    source: 'llm' | 'heuristic' | 'user'
  }
  /** Client corrections and refinement requests retained with the local case draft. */
  feedbackHistory?: Array<{
    kind: 'clarify' | 'add_detail' | 'refine'
    text: string
    at: string
  }>
  /** Local-only snapshots of prior overviews so a refinement can be compared after reload. */
  answerRevisionHistory?: Array<{
    kind: 'clarify' | 'add_detail' | 'refine'
    answerOverview: string
    at: string
  }>
}

export interface ServiceCard {
  id: string
  title: string
  type: string
  blurb: string
  matterTypes: MatterType[]
}
