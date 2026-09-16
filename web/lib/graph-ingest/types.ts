import type { HelpDoorKind } from '@/lib/coherence/peopleFirst'

export type CrawlHit = {
  url: string
  title: string
  excerpt?: string
  fetchedAt?: string
}

export type HardGateAction = 'allow' | 'deny' | 'unknown'

export type HardGate = {
  action: HardGateAction
  code: string
  detail: string
}

export type AiVote = 'allow' | 'deny' | 'review'

export type AiCriticDecision = {
  vote: AiVote
  confidence: number
  doorKind: HelpDoorKind | null
  looksLikeLegalAdvice: boolean
  ukPublicHelp: boolean
  reasons: string[]
}

export type AdmitStatus =
  | 'admitted'
  | 'denied'
  | 'review'
  | 'self_allowed_queue'

export type AdmitResult = {
  url: string
  title: string
  status: AdmitStatus
  doorKind: HelpDoorKind | null
  hard: HardGate
  ai: AiCriticDecision | null
  /** True when a hard deny beat an AI allow. */
  hardDenyWins: boolean
  reasons: string[]
  /** Matching Help / Overview may only use admitted. Queue is not live. */
  clientVisible: boolean
}
