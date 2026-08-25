import type { Prompt, SessionState } from './types'
import { buildQuestionForGap, openCausationGaps } from './causation'
import { maximiseLocalCoherence } from './coherence'
import { proposeLegalFrames } from './frames'
import { clipPhrase } from './timelineExtract'
import {
  deriveTurnState,
  elementAskBinding,
  preferredClarifierFromTurnState,
  suppressedAskIds,
} from './turnState'

const MATTER_OPTIONS: Prompt['options'] = [
  { id: 'm1', label: 'Family / children', value: 'This is mainly about family, children or domestic abuse' },
  { id: 'm2', label: 'Housing / neighbour', value: 'This is mainly about housing or a neighbour dispute' },
  { id: 'm3', label: 'Employment / job', value: 'This is mainly about employment or my job' },
  { id: 'm4', label: 'Debt / bailiffs', value: 'This is mainly about debt, CCJs or bailiffs' },
  {
    id: 'm5',
    label: 'Consumer / tickets / insurance',
    value: 'This is mainly about a purchase, refund, tickets, insurance or disability access',
  },
  { id: 'm6', label: 'Immigration / visas', value: 'This is mainly about immigration or visas' },
  { id: 'm7', label: 'Work injury / accident', value: 'This is mainly about a work injury or accident' },
  { id: 'm8', label: 'Buying or selling a home', value: 'This is about buying or selling a home — conveyancing' },
  { id: 'm9', label: 'Crime / police', value: 'This is mainly about crime or the police' },
  { id: 'm10', label: 'Something else', value: 'This is about something else' },
]

/** Closed matter classifier — also used before Matching Help when matter is still unknown. */
export function matterClassifierPrompt(
  session: SessionState,
  id: 'matter' | 'matter_for_services' = 'matter',
): Prompt {
  const opener = session.rawInputs[0]?.trim()
  const hook = opener
    ? `You wrote “${clipPhrase(opener, 64)}”.`
    : id === 'matter_for_services'
      ? 'From what you shared,'
      : 'From your first message,'
  return {
    id,
    kind: 'closed',
    text:
      id === 'matter_for_services'
        ? `${hook} Matching Help needs a legal area first. Which is it mainly about?`
        : `${hook} Which of these is it mainly about?`,
    reason:
      id === 'matter_for_services'
        ? 'Matter unknown — one clarifying question before Matching Help so free services and solicitors can match.'
        : 'Matter type selects the causation model — asked only when sensing cannot classify yet.',
    options: MATTER_OPTIONS,
  }
}

/** Higher = ask sooner. Coherence constraints outrank generic early gaps. */
const CONSTRAINT_PRIORITY: Record<string, number> = {
  constraint_goal: 100,
  constraint_jurisdiction: 98,
  constraint_safety: 99,
  constraint_protection_basis: 94,
  constraint_family_link: 93,
  constraint_character_detail: 92,
  constraint_housing_notice: 91,
  constraint_debt_stage: 91,
  constraint_employment_status: 90,
  constraint_acas: 89,
  constraint_leave_status: 90,
  constraint_removal_when: 90,
  constraint_children_detail: 88,
  constraint_consumer_proof: 88,
  constraint_decision_letter: 88,
  constraint_decision_date: 72,
  constraint_timeline_thin: 58,
}

const GAP_THEME: Record<string, string> = {
  gap_goal: 'goal',
  gap_where: 'jurisdiction',
  gap_evidence: 'evidence',
  gap_when: 'deadline',
  gap_refusal_reason: 'refusal_reason',
  gap_character: 'character_detail',
  gap_incident_detail: 'timeline',
  gap_housing_trigger: 'timeline',
  gap_responsible: 'parties',
  gap_breach: 'cause',
  gap_aftermath: 'timeline',
}

const CONSTRAINT_THEME: Record<string, string> = {
  constraint_goal: 'goal',
  constraint_jurisdiction: 'jurisdiction',
  constraint_decision_date: 'deadline',
  constraint_decision_letter: 'decision_letter',
  constraint_leave_status: 'leave_status',
  constraint_family_link: 'family_link',
  constraint_protection_basis: 'protection_basis',
  constraint_removal_when: 'removal_detail',
  constraint_character_detail: 'character_detail',
  constraint_timeline_thin: 'timeline',
  constraint_housing_notice: 'evidence',
  constraint_employment_status: 'employment_status',
  constraint_acas: 'acas',
  constraint_debt_stage: 'debt_stage',
  constraint_children_detail: 'children',
  constraint_safety: 'safety',
  constraint_consumer_proof: 'evidence',
}

type RankedAsk = {
  id: string
  kind: Prompt['kind']
  text: string
  reason: string
  options?: Prompt['options']
  priority: number
  theme: string
  source: 'coherence' | 'gap' | 'turn'
}

/**
 * Merge Phase 3 unmet constraints with causation gaps; ask highest-value first.
 * Dedupes by theme so we don't ask jurisdiction twice.
 * When a topic pack is locked, prefer turn-state missing elements (MAP-Law clarify).
 */
export function nextInteractiveAsk(session: SessionState): RankedAsk | null {
  if (session.matterType === 'unknown') return null

  const frames = proposeLegalFrames(session, 5)
  const turn = deriveTurnState(session, frames)
  const suppress = suppressedAskIds(turn)
  const missingAskIds = new Set(
    turn.missing
      .map((el) => elementAskBinding(el)?.id)
      .filter((id): id is string => Boolean(id)),
  )

  // Coverage ready: only ask still-missing pack elements; else hand off (complete).
  if (turn.nextAction === 'stop_overview' && turn.lock) {
    const clarifier = preferredClarifierFromTurnState(session, frames)
    if (!clarifier) return null
    return { ...clarifier, source: 'turn' }
  }

  const pass = maximiseLocalCoherence(session, frames, [], 3)
  const candidates: RankedAsk[] = []
  const themes = new Set<string>()

  const turnClarifier = preferredClarifierFromTurnState(session, frames)
  if (turnClarifier && !suppress.has(turnClarifier.id)) {
    themes.add(turnClarifier.theme)
    candidates.push({ ...turnClarifier, source: 'turn' })
  }

  for (const c of pass.clarifierSuggestions) {
    if (session.answeredPromptIds.includes(c.id)) continue
    if (suppress.has(c.id)) continue
    // When clarifying a locked pack, skip constraints that are not for missing elements
    // (avoids landlord notice / generic housing crowding out evidence/goal).
    if (
      turn.lock &&
      (turn.nextAction === 'clarify' || turn.nextAction === 'retrieve_scoped') &&
      missingAskIds.size > 0 &&
      !missingAskIds.has(c.id) &&
      c.id === 'constraint_housing_notice'
    ) {
      continue
    }
    const theme = CONSTRAINT_THEME[c.id] || c.id
    if (themes.has(theme)) continue
    themes.add(theme)
    candidates.push({
      id: c.id,
      kind: 'open',
      text: c.text,
      reason: c.reason,
      priority: CONSTRAINT_PRIORITY[c.id] ?? 80,
      theme,
      source: 'coherence',
    })
  }

  for (const gap of openCausationGaps(session)) {
    if (session.answeredPromptIds.includes(gap.id)) continue
    if (suppress.has(gap.id)) continue
    const theme = GAP_THEME[gap.id] || gap.id
    if (themes.has(theme)) continue // coherence / turn already covering this theme
    themes.add(theme)
    const q = buildQuestionForGap(session, gap)
    // Boost gaps that close missing pack elements
    const packBoost = missingAskIds.has(gap.id) ? 25 : 0
    candidates.push({
      id: q.id,
      kind: q.kind,
      text: q.text,
      reason: q.reason,
      options: q.options,
      // Slightly below matching constraint priorities so fit-led asks win ties
      priority: gap.priority * 0.85 + packBoost,
      theme,
      source: 'gap',
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.priority - a.priority)
  return candidates[0]
}

export function nextPrompt(session: SessionState): Prompt {
  if (session.rawInputs.length === 0) {
    if (session.mode === 'browse') {
      return {
        id: 'open',
        kind: 'open',
        text: 'What kind of help are you looking for, and roughly where (city or nation)?',
        reason: 'Browse path — matter + place unlock services without a full dispute timeline.',
      }
    }
    if (session.mode === 'info') {
      return {
        id: 'open',
        kind: 'open',
        text: 'What do you want to understand? A short plain-language question is enough.',
        reason: 'Info path — light sensing, then matching guidance links.',
      }
    }
    if (session.mode === 'research') {
      return {
        id: 'open',
        kind: 'open',
        text: 'Describe your situation in a few sentences — OSLAW will match open wiki pathways and suggest a practical course of action.',
        reason: 'OSLAW research path — short story → wiki pathway course of action.',
      }
    }
    return {
      id: 'open',
      kind: 'open',
      text: 'Tell me what happened — or what you’re looking for — in your own words.',
      reason: 'Opening account — we sense detail first, then identify causation gaps.',
    }
  }

  if (session.safetyRisk && !session.answeredPromptIds.includes('safety')) {
    return {
      id: 'safety',
      kind: 'closed',
      text: 'You mentioned something that may involve immediate risk. Are you safe right now, or do you need urgent help first?',
      reason: 'Safety overrides causation building.',
      options: [
        { id: 's1', label: 'I am safe for now', value: 'I am safe for now' },
        { id: 's2', label: 'I need urgent help', value: 'I need urgent help right now' },
        { id: 's3', label: 'I am in immediate danger', value: 'I am in immediate danger' },
      ],
    }
  }

  // If matter still unknown after first input, ask closed classifier once — grounded in their words
  if (session.matterType === 'unknown' && !session.answeredPromptIds.includes('matter')) {
    return matterClassifierPrompt(session, 'matter')
  }

  // Browse / info / OSLAW research: skip deep causation once matter (+ place when possible) is known
  if (session.mode === 'browse' || session.mode === 'info' || session.mode === 'research') {
    if (
      session.matterType !== 'unknown' &&
      (session.locationHint ||
        session.jurisdiction !== 'Unknown' ||
        session.mode === 'info' ||
        session.mode === 'research')
    ) {
      return {
        id: 'complete',
        kind: 'closed',
        text:
          session.mode === 'research'
            ? 'Ready for an open-source course of action from the wiki.'
            : 'You’re ready for the next step.',
        reason:
          session.mode === 'research'
            ? 'OSLAW path complete enough to rank wiki pathways.'
            : 'Browse/info path complete enough for signposts and handoff notes.',
      }
    }
    if (!session.locationHint && session.jurisdiction === 'Unknown' && !session.answeredPromptIds.includes('gap_where')) {
      return {
        id: 'gap_where',
        kind: 'closed',
        text: 'Where is this — England, Wales, Scotland, Northern Ireland, or a city?',
        reason: 'Place unlocks jurisdiction-safe signposts on the browse path.',
        options: [
          { id: 'w1', label: 'England', value: 'England' },
          { id: 'w2', label: 'Wales', value: 'Wales' },
          { id: 'w3', label: 'Scotland', value: 'Scotland' },
          { id: 'w4', label: 'Northern Ireland', value: 'Northern Ireland' },
          { id: 'w5', label: 'London', value: 'London' },
        ],
      }
    }
  }

  // Phase 3: coherence-first merge with causation gaps (interactive agent loop)
  const ask = nextInteractiveAsk(session)
  if (ask) {
    return {
      id: ask.id,
      kind: ask.kind,
      text: ask.text,
      reason: ask.reason,
      options: ask.options,
    }
  }

  return {
    id: 'complete',
    kind: 'closed',
    text: 'You’re ready for the next step.',
    reason: 'Core causation gaps are filled — hand off notes or find people to help.',
  }
}
