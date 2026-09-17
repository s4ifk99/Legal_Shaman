/**
 * Turn-level legal state (SaLSA / MAP-Law inspired).
 * Drives intake clarify priority via nextInteractiveAsk.
 * See docs/product-decisions/coherence-turn-state.md
 */
import type { LegalFrame } from './frames'
import { proposeLegalFrames } from './frames'
import { buildRetrievalText } from './retrievalText'
import { resolveTopicLock, type LockedPackId, type TopicLock } from './topicLock'
import type { PredictiveChoice, Prompt, SessionState } from './types'

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

/** Ask candidate produced for the interactive loop (mirrors questions.RankedAsk shape). */
export type TurnClarifier = {
  id: string
  kind: Prompt['kind']
  text: string
  reason: string
  options?: PredictiveChoice[]
  priority: number
  theme: string
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

/**
 * Prompt ids / gap ids to suppress when a pack is locked (landlord bleed on neighbour, etc.).
 */
export function suppressedAskIds(state: TurnState): Set<string> {
  const out = new Set<string>()
  if (state.packId === 'neighbour-access-dispute') {
    out.add('constraint_housing_notice')
    out.add('gap_housing_trigger')
  }
  if (state.packId === 'car-reject-failed-repair') {
    out.add('constraint_housing_notice')
    out.add('gap_housing_trigger')
  }
  return out
}

/** Map pack element → existing gap / constraint id + theme for the ask loop. */
export function elementAskBinding(elementId: ElementId): { id: string; theme: string } | null {
  switch (elementId) {
    case 'jurisdiction':
      return { id: 'gap_where', theme: 'jurisdiction' }
    case 'evidence':
      return { id: 'gap_evidence', theme: 'evidence' }
    case 'goal':
    case 'remedy_sought':
      return { id: 'gap_goal', theme: 'goal' }
    case 'access_harm':
    case 'purchase':
    case 'fault':
    case 'notice_type':
      return { id: 'gap_incident_detail', theme: 'timeline' }
    case 'counterparty_neighbour':
      return { id: 'gap_responsible', theme: 'parties' }
    default:
      return null
  }
}

/**
 * Highest-priority clarifier for the first missing pack element.
 * Returns null if covered enough or the element was already answered.
 */
export function preferredClarifierFromTurnState(
  session: SessionState,
  frames?: LegalFrame[],
): TurnClarifier | null {
  const liveFrames = frames?.length ? frames : proposeLegalFrames(session, 5)
  const state = deriveTurnState(session, liveFrames)
  if (!state.lock || !state.missing.length) return null
  if (state.nextAction === 'stop_overview') return null

  for (const elementId of state.missing) {
    if (session.answeredPromptIds.includes(`element_${elementId}`)) continue
    const clarifier = preferredClarifierForElement(session, state, elementId)
    if (clarifier) return clarifier
  }
  return null
}

function preferredClarifierForElement(
  session: SessionState,
  state: TurnState,
  elementId: ElementId,
): TurnClarifier | null {
  const binding = elementAskBinding(elementId)
  if (!binding) return null
  if (session.answeredPromptIds.includes(binding.id)) return null

  const built = buildElementClarifierPrompt(session, state, elementId, binding.id)
  if (!built) return null
  return {
    ...built,
    priority: 110, // Above coherence constraints so pack coverage wins
    theme: binding.theme,
  }
}

function buildElementClarifierPrompt(
  session: SessionState,
  state: TurnState,
  elementId: ElementId,
  promptId: string,
): Omit<TurnClarifier, 'priority' | 'theme'> | null {
  void session
  const pack = state.packId
  switch (elementId) {
    case 'jurisdiction':
      return {
        id: promptId,
        kind: 'closed',
        text: 'Where is this happening — England, Wales, Scotland, Northern Ireland, or a city?',
        reason: `Turn state: need jurisdiction for ${pack}.`,
        options: [
          { id: 'w1', label: 'England', value: 'England' },
          { id: 'w2', label: 'Wales', value: 'Wales' },
          { id: 'w3', label: 'Scotland', value: 'Scotland' },
          { id: 'w4', label: 'Northern Ireland', value: 'Northern Ireland' },
          { id: 'w5', label: 'London', value: 'London' },
        ],
      }
    case 'evidence':
      return {
        id: promptId,
        kind: 'closed',
        text:
          pack === 'neighbour-access-dispute'
            ? 'Do you already have photos, messages, or other evidence of the neighbour blocking access?'
            : 'Do you already have anything in writing (letters, photos, messages)?',
        reason: `Turn state: evidence still open for ${pack}.`,
        options:
          pack === 'neighbour-access-dispute'
            ? [
                { id: 'd1', label: 'Photos / video', value: 'I have photos or video of the blocked driveway or car port' },
                { id: 'd2', label: 'Messages / emails', value: 'I have messages or emails with the neighbour about access' },
                { id: 'd3', label: 'Council / police report', value: 'I have reported this to the council or police' },
                { id: 'd4', label: 'Nothing yet', value: 'I have no documents or evidence yet' },
              ]
            : [
                { id: 'd1', label: 'Official letter / notice', value: 'I have an official letter or notice' },
                { id: 'd2', label: 'Messages', value: 'I have messages about this' },
                { id: 'd3', label: 'Nothing yet', value: 'I have no documents yet' },
              ],
      }
    case 'goal':
    case 'remedy_sought':
      return {
        id: promptId,
        kind: 'closed',
        text:
          pack === 'neighbour-access-dispute'
            ? 'What would a good outcome look like — stop the parking / car port, restore access, or something else?'
            : pack === 'car-reject-failed-repair'
              ? 'What do you want next — reject the car, a refund, a repair, or to understand your options?'
              : 'What do you want a lawyer or adviser to help you achieve next?',
        reason: `Turn state: goal still open for ${pack}.`,
        options:
          pack === 'neighbour-access-dispute'
            ? [
                { id: 'g1', label: 'Stop the blocking', value: 'I want the neighbour to stop blocking my driveway or access' },
                { id: 'g2', label: 'Remove / challenge the car port', value: 'I want to challenge or remove the car port blocking access' },
                { id: 'g3', label: 'Understand my options', value: 'I want to understand my lawful options about access' },
              ]
            : pack === 'car-reject-failed-repair'
              ? [
                  { id: 'g1', label: 'Reject / refund', value: 'I want to reject the car or get a refund' },
                  { id: 'g2', label: 'Repair', value: 'I want the trader to repair the car properly' },
                  { id: 'g3', label: 'Understand options', value: 'I want to understand my Consumer Rights Act options' },
                ]
              : [
                  { id: 'g1', label: 'Appeal / cancel', value: 'I want to appeal or cancel the parking charge' },
                  { id: 'g2', label: 'Understand options', value: 'I want to understand my options about the parking notice' },
                ],
      }
    case 'access_harm':
      return {
        id: promptId,
        kind: 'open',
        text: 'What exactly is the neighbour doing that blocks you — parking, a car port, a fence, or something else?',
        reason: 'Turn state: access harm not yet clear.',
        options: [
          { id: 'a1', label: 'Parking on driveway', value: 'My neighbour is parking on or across my driveway' },
          { id: 'a2', label: 'Building a car port', value: 'My neighbour is building a car port that blocks access' },
          { id: 'a3', label: 'Other blocking', value: 'My neighbour is blocking access another way — I will explain' },
        ],
      }
    case 'counterparty_neighbour':
      return {
        id: promptId,
        kind: 'closed',
        text: 'Is this mainly about your neighbour (or someone next door), rather than a landlord or trader?',
        reason: 'Turn state: confirm neighbour as the other party.',
        options: [
          { id: 'r1', label: 'Yes — my neighbour', value: 'My neighbour is mainly responsible for this problem' },
          { id: 'r2', label: 'Someone else', value: 'Someone other than my neighbour may be responsible' },
          { id: 'r3', label: 'Not sure', value: 'I am not sure who is responsible yet' },
        ],
      }
    case 'purchase':
      return {
        id: promptId,
        kind: 'open',
        text: 'Who did you buy the vehicle from — a dealer/trader, or a private seller — and roughly when?',
        reason: 'Turn state: purchase details needed for used-car pack.',
        options: [
          { id: 'p1', label: 'Dealer / trader', value: 'I bought the used car from a dealer or trader' },
          { id: 'p2', label: 'Private seller', value: 'I bought the car from a private seller' },
        ],
      }
    case 'fault':
      return {
        id: promptId,
        kind: 'open',
        text: 'What went wrong with the car — and when did you first notice it?',
        reason: 'Turn state: fault details needed for used-car pack.',
        options: [
          { id: 'f1', label: 'Broke down', value: 'The car broke down soon after I bought it' },
          { id: 'f2', label: 'Fault codes / not fixed', value: 'The car has faults that were not fixed properly' },
        ],
      }
    case 'notice_type':
      return {
        id: promptId,
        kind: 'closed',
        text: 'Is this a council PCN, or a private parking charge from a car-park operator?',
        reason: 'Turn state: need notice type for parking pack.',
        options: [
          { id: 'n1', label: 'Council PCN', value: 'This is a council parking ticket or PCN' },
          { id: 'n2', label: 'Private parking charge', value: 'This is a private parking charge from an operator' },
          { id: 'n3', label: 'Not sure', value: 'I am not sure whether this is council or private parking' },
        ],
      }
    default:
      return null
  }
}

/** Convenience: derive state from session alone (frames proposed inside). */
export function deriveTurnStateForSession(session: SessionState): TurnState {
  return deriveTurnState(session, proposeLegalFrames(session, 5))
}
