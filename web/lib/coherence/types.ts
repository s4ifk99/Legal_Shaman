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
}
import type { SessionMatterFrame } from './matterFrame'

export interface ServiceCard {
  id: string
  title: string
  type: string
  blurb: string
  matterTypes: MatterType[]
}
