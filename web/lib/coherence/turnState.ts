/**
 * Turn-level legal state (SaLSA / MAP-Law inspired).
 * Phase 1: derive coverage + nextAction for traps and future intake wiring.
 * See docs/product-decisions/coherence-turn-state.md
 */
import type { LegalFrame } from './frames'
import { buildRetrievalText } from './retrievalText'
import { resolveTopicLock, type LockedPackId, type TopicLock } from './topicLock'
import type { SessionState } from './types'

export type TurnAction = 'clarify' | 'retrieve_scoped' | 'reformulate' | 'stop_overview'

export type ElementId = string

export type TurnState = {
  lock: TopicLock | null
  packId: LockedPackId | null
  covered: ElementId[]
  missing: ElementId[]
  coverage: number
  nextAction: TurnAction
  reason: string
}

type ElementDef = {
  id: ElementId
  test: (session: SessionState, blob: string) => boolean
}

const NEIGHBOUR_ELEMENTS: ElementDef[] = [
  {
    id: 'counterparty_neighbour',
    test: (s, b) =>
      s.parties.some((p) => p.role === 'neighbour' || /neighbour|neighbor/i.test(p.label)) ||
      /\b(neighbour|neighbor)\b/i.test(b),
  },
  {
    id: 'access_harm',
    test: (_s, b) =>
      /\b(driveway|car\s*port|carport|parking|park(?:ed|ing)|blocking|access|right of way|easement)\b/i.test(
        b,
      ),
  },
  {
    id: 'jurisdiction',
    test: (s) => s.jurisdiction !== 'Unknown' || Boolean(s.locationHint?.trim()),
  },
  {
    id: 'evidence',
    test: (s, b) =>
      s.documents.length > 0 ||
      s.answeredPromptIds.includes('gap_evidence') ||
      /\b(photo|photos|video|message|email|evidence)\b/i.test(b),
  },
  {
    id: 'goal',
    test: (s) =>
      s.goal.trim().length >= 8 ||
      s.answeredPromptIds.includes('gap_goal') ||
      s.answeredPromptIds.includes('constraint_goal'),
  },
]

const CAR_ELEMENTS: ElementDef[] = [
  {
    id: 'purchase',
    test: (_s, b) => /\b(bought|purchase|dealer|used car|trader)\b/i.test(b),
  },
  {
    id: 'fault',
    test: (_s, b) => /\b(broke|broken|faulty|fault codes?|not working|defect)\b/i.test(b),
  },
  {
    id: 'remedy_sought',
    test: (_s, b) => /\b(reject|refund|repair|replace|money back)\b/i.test(b),
  },
  {
    id: 'jurisdiction',
    test: (s) => s.jurisdiction !== 'Unknown' || Boolean(s.locationHint?.trim()),
  },
]

const PARKING_ELEMENTS: ElementDef[] = [
  {
    id: 'notice_type',
    test: (_s, b) =>
      /\b(pcn|parking (?:fine|ticket|charge)|private parking|car\s*park|popla)\b/i.test(b),
  },
  {
    id: 'jurisdiction',
    test: (s) => s.jurisdiction !== 'Unknown' || Boolean(s.locationHint?.trim()),
  },
  {
    id: 'goal',
    test: (s) => s.goal.trim().length >= 8 || s.answeredPromptIds.includes('gap_goal'),
  },
]

function elementsForPack(packId: LockedPackId | null): ElementDef[] {
  switch (packId) {
    case 'neighbour-access-dispute':
      return NEIGHBOUR_ELEMENTS
    case 'car-reject-failed-repair':
      return CAR_ELEMENTS
    case 'private-parking-charge':
      return PARKING_ELEMENTS
    default:
      return []
  }
}

function blob(session: SessionState, frames: LegalFrame[]): string {
  return `${buildRetrievalText(session)} ${frames.map((f) => f.id).join(' ')}`
}

/**
 * Derive coverage and the recommended control action for this turn.
 * Does not mutate the session.
 */
export function deriveTurnState(
  session: SessionState,
  frames: LegalFrame[] = [],
  lock = resolveTopicLock(session, frames),
): TurnState {
  const packId = lock?.packId ?? null
  const defs = elementsForPack(packId)
  const text = blob(session, frames)

  if (!packId || !defs.length) {
    return {
      lock,
      packId,
      covered: [],
      missing: [],
      coverage: 0,
      nextAction: session.rawInputs.length < 2 ? 'clarify' : 'retrieve_scoped',
      reason: lock ? 'lock-without-element-map' : 'no-topic-lock',
    }
  }

  const covered: ElementId[] = []
  const missing: ElementId[] = []
  for (const def of defs) {
    if (def.test(session, text)) covered.push(def.id)
    else missing.push(def.id)
  }
  const coverage = covered.length / defs.length

  // Core story elements for neighbour / car must exist before Overview
  const coreMissing = missing.filter((id) =>
    ['counterparty_neighbour', 'access_harm', 'purchase', 'fault', 'notice_type'].includes(id),
  )

  let nextAction: TurnAction
  let reason: string
  if (coreMissing.length) {
    nextAction = 'clarify'
    reason = `missing-core:${coreMissing[0]}`
  } else if (coverage < 0.6) {
    nextAction = 'clarify'
    reason = `low-coverage:${missing[0] || 'unknown'}`
  } else if (coverage >= 0.8) {
    nextAction = 'stop_overview'
    reason = 'coverage-ready'
  } else {
    nextAction = 'retrieve_scoped'
    reason = 'partial-coverage-scoped-retrieve'
  }

  return { lock, packId, covered, missing, coverage, nextAction, reason }
}

/** True when Overview must not run an unscoped / conflicting pack. */
export function mustScopeRetrieval(state: TurnState): boolean {
  return Boolean(state.lock) && state.nextAction !== 'clarify'
}
