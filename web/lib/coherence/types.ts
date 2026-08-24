import type { SessionMatterFrame } from './matterFrame'

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
}

export interface ServiceCard {
  id: string
  title: string
  type: string
  blurb: string
  matterTypes: MatterType[]
}
