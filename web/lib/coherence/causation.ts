import type { MatterType, PredictiveChoice, QuestionKind, SessionState } from './types'
import { looksNeighbourDispute } from './sense'
import { clipPhrase } from './timelineExtract'

export type { QuestionKind, PredictiveChoice }

export interface CausationGap {
  id: string
  /** Human label for progress / brief */
  label: string
  priority: number
  kind: QuestionKind
  /** Why this gap matters for identifying / building causation */
  reason: string
  filled: boolean
}

export interface CausationQuestion {
  id: string
  gapId: string
  kind: QuestionKind
  text: string
  /** Short explanation shown subtly in UI */
  reason: string
  options: PredictiveChoice[]
}

function clip(text: string, max = 72): string {
  return clipPhrase(text, max)
}

/** Best concrete phrase already given by the client — never a vague placeholder if avoidable. */
function cite(session: SessionState): string {
  if (session.whatHappened.trim()) return clip(session.whatHappened, 64)
  const storyEvent = [...session.events]
    .reverse()
    .find((e) => e.kind === 'event' && !/^cause:|^mechanism:|^harm:|^work status:/i.test(e.label))
  if (storyEvent?.rawSpan) return clip(storyEvent.rawSpan, 64)
  if (storyEvent) return clip(storyEvent.label, 64)
  const last = [...session.rawInputs].reverse().find((r) => r.trim().length > 8)
  if (last) return clip(last, 64)
  return ''
}

function partyLabel(session: SessionState): string {
  if (session.parties[0]) return session.parties[0].label
  return ''
}

function isNeighbourHousing(session: SessionState): boolean {
  return looksNeighbourDispute(corpus(session))
}

function housingActor(session: SessionState): string {
  if (isNeighbourHousing(session)) return 'my neighbour'
  return partyLabel(session) || 'the landlord'
}

function causeSnippet(session: SessionState): string {
  if (session.howCaused.trim()) return clip(session.howCaused, 56)
  const causeEv = [...session.events].reverse().find((e) => /^cause:|^mechanism:/i.test(e.label))
  return causeEv ? clip(causeEv.label.replace(/^cause:\s*/i, ''), 56) : ''
}

function mustGround(text: string, session: SessionState): string {
  // Guarantee the client's material appears in the question when we have any
  const anchor = cite(session)
  if (!anchor) return text
  if (text.includes(anchor) || text.includes(`“${anchor}”`)) return text
  return `You said “${anchor}”. ${text}`
}

function corpus(session: SessionState): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => `${e.label} ${e.rawSpan ?? ''}`),
    ...session.parties.map((p) => `${p.label} ${p.role ?? ''}`),
  ]
    .join(' ')
    .toLowerCase()
}

/** True when the client has already given enough ordered narrative for intake. */
export function hasRichNarrative(session: SessionState): boolean {
  if (session.whatHappened.trim().length >= 40) return true
  if (session.answeredPromptIds.includes('gap_incident_detail')) return true
  const storyEvents = session.events.filter((e) => e.kind === 'event')
  const eventText = storyEvents.map((e) => e.rawSpan || e.label).join(' ')
  if (storyEvents.length >= 3) return true
  if (storyEvents.length >= 2 && eventText.length >= 80) return true
  const longestInput = Math.max(0, ...session.rawInputs.map((r) => r.trim().length))
  if (longestInput >= 300 && storyEvents.length >= 2) return true
  return false
}

function answered(session: SessionState, id: string): boolean {
  return session.answeredPromptIds.includes(id)
}

function hasPartyRole(session: SessionState, role: string): boolean {
  return session.parties.some((p) => (p.role ?? '').toLowerCase() === role || p.label.toLowerCase().includes(role))
}

/** Facts the engine believes it already has — used to reason about remaining gaps. */
export function knownCausationFacts(session: SessionState): string[] {
  const facts: string[] = []
  if (session.matterType !== 'unknown') facts.push(`matter:${session.matterType}`)
  if (session.whatHappened) facts.push('narrative:what_happened')
  if (session.howCaused) facts.push('narrative:how_caused')
  if (session.events.length >= 2) facts.push('narrative:sequence')
  if (session.parties.length) facts.push('actors:named')
  if (hasPartyRole(session, 'employer')) facts.push('actors:employer')
  if (hasPartyRole(session, 'landlord')) facts.push('actors:landlord')
  if (session.documents.length) facts.push('documents:mentioned')
  if (session.goal) facts.push('goal:stated')
  const c = corpus(session)
  if (/slip|fell|fall|trip/.test(c)) facts.push('mechanism:slip_fall')
  if (/hit|struck|collision|crash/.test(c)) facts.push('mechanism:impact')
  if (/unsafe|no training|faulty|broken|wet floor|no guard/.test(c)) facts.push('breach:safety_hint')
  if (/employer|workplace|at work/.test(c)) facts.push('context:work')
  if (/refus|reject|home office|ilr|visa/.test(c)) facts.push('context:immigration')
  if (/landlord|evict|lock(?:ed)? out|mould|mold|\brents?\b|tenancy|section\s*21/.test(c)) facts.push('context:housing')
  if (/refund|faulty|trader|warranty|\bcar\b|dealer|garage|fault codes?/.test(c)) facts.push('context:consumer')
  if (/negligen|fault|responsible|their fault|caused by/.test(c)) facts.push('attribution:blame_hint')
  if (/a&e|gp|doctor|hospital|injur|hurt|pain/.test(c)) facts.push('harm:injury_hint')
  if (/report|grievance|complain|told (?:hr|manager|boss)/.test(c)) facts.push('aftermath:reported')
  return facts
}

function piGaps(session: SessionState): CausationGap[] {
  const c = corpus(session)
  const facts = new Set(knownCausationFacts(session))
  const thinNarrative = !hasRichNarrative(session)

  return [
    {
      id: 'gap_incident_detail',
      label: 'What exactly happened',
      priority: 100,
      kind: 'open',
      reason: 'Need a concrete incident narrative before cause can be tested.',
      filled: !thinNarrative,
    },
    {
      id: 'gap_mechanism',
      label: 'How the injury occurred',
      priority: 95,
      kind: facts.has('mechanism:slip_fall') || facts.has('mechanism:impact') ? 'closed' : 'open',
      reason: 'Mechanism links the event to possible duty breaches.',
      filled:
        answered(session, 'gap_mechanism') ||
        facts.has('mechanism:slip_fall') ||
        facts.has('mechanism:impact') ||
        /slip|fell|hit|struck|machinery|lifting|chemical|burn/.test(session.howCaused + session.whatHappened),
    },
    {
      id: 'gap_responsible',
      label: 'Who may be responsible',
      priority: 90,
      kind: 'closed',
      reason: 'Causation needs an alleged responsible party to hang against.',
      filled:
        answered(session, 'gap_responsible') ||
        hasPartyRole(session, 'employer') ||
        /employer|company|driver|contractor/.test(c),
    },
    {
      id: 'gap_breach',
      label: 'What went wrong',
      priority: 88,
      kind: 'open',
      reason: 'Builds the alleged failure that caused the harm.',
      filled:
        answered(session, 'gap_breach') ||
        session.howCaused.trim().length >= 20 ||
        facts.has('breach:safety_hint'),
    },
    {
      id: 'gap_employer_duty',
      label: 'Work relationship',
      priority: 85,
      kind: 'closed',
      reason: 'Confirms employment / workplace duty context for causation.',
      filled:
        answered(session, 'gap_employer_duty') ||
        (!facts.has('context:work') && session.matterType !== 'personal_injury') ||
        /employed|my job|zero hours|agency|contractor/.test(c) ||
        hasPartyRole(session, 'employer'),
    },
    {
      id: 'gap_harm',
      label: 'Injury / harm',
      priority: 80,
      kind: 'open',
      reason: 'Loss/harm completes the cause → effect chain.',
      filled: answered(session, 'gap_harm') || facts.has('harm:injury_hint'),
    },
    {
      id: 'gap_aftermath',
      label: 'What followed',
      priority: 70,
      kind: 'closed',
      reason: 'Aftermath supports sequence and evidence of the incident.',
      filled: answered(session, 'gap_aftermath') || facts.has('aftermath:reported') || session.events.length >= 3,
    },
    {
      id: 'gap_when',
      label: 'When it happened',
      priority: 60,
      kind: 'closed',
      reason: 'Timing anchors the timeline and limitation risk.',
      filled: answered(session, 'gap_when') || session.events.some((e) => Boolean(e.dateApprox)),
    },
    {
      id: 'gap_where',
      label: 'Where it happened',
      priority: 55,
      kind: 'closed',
      reason: 'Place fixes jurisdiction for any later legal frame.',
      filled:
        answered(session, 'gap_where') ||
        session.jurisdiction !== 'Unknown' ||
        Boolean(session.locationHint),
    },
    {
      id: 'gap_evidence',
      label: 'Evidence / documents',
      priority: 40,
      kind: 'closed',
      reason: 'Documents help prove the causal story to a lawyer.',
      filled: answered(session, 'gap_evidence') || session.documents.length > 0,
    },
    {
      id: 'gap_goal',
      label: 'Desired outcome',
      priority: 20,
      kind: 'closed',
      reason: 'Outcome is asked only once the cause story is usable.',
      filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
    },
  ]
}

function housingGaps(session: SessionState): CausationGap[] {
  const c = corpus(session)
  const neighbour = isNeighbourHousing(session)
  return [
    {
      id: 'gap_incident_detail',
      label: 'What exactly happened',
      priority: 100,
      kind: 'open',
      reason: neighbour
        ? 'Need the neighbour dispute story before cause can be built.'
        : 'Need the housing story before cause can be built.',
      filled: hasRichNarrative(session),
    },
    {
      id: 'gap_housing_trigger',
      label: 'What started it',
      priority: 92,
      kind: 'closed',
      reason: 'Identifies the trigger event in the causal chain.',
      filled:
        answered(session, 'gap_housing_trigger') ||
        (neighbour
          ? /neighbour|neighbor|driveway|parking|park(?:ed|ing)|boundary|noise|access|blocking/.test(c)
          : /mould|mold|\brepairs?\b|\brents?\b|notice|lock|evict|section\s*21|section\s*8/.test(c)),
    },
    {
      id: 'gap_responsible',
      label: 'Who is responsible',
      priority: 90,
      kind: 'closed',
      reason: neighbour
        ? 'Neighbour attribution for causation.'
        : 'Landlord/agent attribution for causation.',
      filled:
        answered(session, 'gap_responsible') ||
        (neighbour
          ? hasPartyRole(session, 'neighbour') || /neighbour|neighbor/.test(c)
          : hasPartyRole(session, 'landlord') || /landlord|agent/.test(c)),
    },
    {
      id: 'gap_breach',
      label: 'What they failed to do',
      priority: 85,
      kind: 'open',
      reason: 'Alleged failure links actor → harm.',
      filled: answered(session, 'gap_breach') || session.howCaused.trim().length >= 20,
    },
    {
      id: 'gap_aftermath',
      label: 'What followed',
      priority: 70,
      kind: 'open',
      reason: 'Sequence after the trigger.',
      filled: answered(session, 'gap_aftermath') || session.events.length >= 2,
    },
    {
      id: 'gap_when',
      label: 'When it happened',
      priority: 60,
      kind: 'closed',
      reason: 'Timing for timeline and urgency.',
      filled: answered(session, 'gap_when') || session.events.some((e) => Boolean(e.dateApprox)),
    },
    {
      id: 'gap_where',
      label: 'Where the property is',
      priority: 55,
      kind: 'closed',
      reason: neighbour
        ? 'Jurisdiction for neighbour dispute pathways.'
        : 'Jurisdiction for housing pathways.',
      filled:
        answered(session, 'gap_where') ||
        session.jurisdiction !== 'Unknown' ||
        Boolean(session.locationHint),
    },
    {
      id: 'gap_evidence',
      label: 'Evidence / documents',
      priority: 40,
      kind: 'closed',
      reason: neighbour
        ? 'Photos, messages, or council reports support the story.'
        : 'Tenancy/notices support the story.',
      filled: answered(session, 'gap_evidence') || session.documents.length > 0,
    },
    {
      id: 'gap_goal',
      label: 'Desired outcome',
      priority: 20,
      kind: 'closed',
      reason: 'Asked after the causal story is in place.',
      filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
    },
  ]
}

function immigrationGaps(session: SessionState): CausationGap[] {
  const c = corpus(session)
  return [
    {
      id: 'gap_incident_detail',
      label: 'Application history',
      priority: 100,
      kind: 'open',
      reason: 'Need the application/refusal sequence.',
      filled: hasRichNarrative(session),
    },
    {
      id: 'gap_refusal_reason',
      label: 'Reason given for refusal',
      priority: 93,
      kind: 'open',
      reason: 'Official reason is the stated causal basis to test.',
      filled:
        answered(session, 'gap_refusal_reason') ||
        session.howCaused.trim().length >= 20 ||
        /character|suitability|income|english|absence|decept/.test(c),
    },
    {
      id: 'gap_character',
      label: 'Character / suitability',
      priority: 88,
      kind: 'closed',
      reason: 'Checks whether character is part of the causal story.',
      filled:
        answered(session, 'gap_character') ||
        session.softFlags.includes('character_concern_raised') ||
        (!/character|criminal|conviction|suitability/.test(c) && answered(session, 'gap_refusal_reason')),
    },
    {
      id: 'gap_when',
      label: 'When decided',
      priority: 60,
      kind: 'closed',
      reason: 'Decision timing for deadlines.',
      filled: answered(session, 'gap_when') || session.events.some((e) => Boolean(e.dateApprox)),
    },
    {
      id: 'gap_where',
      label: 'Where you are based',
      priority: 55,
      kind: 'closed',
      reason: 'Location / jurisdiction context.',
      filled:
        answered(session, 'gap_where') ||
        session.jurisdiction !== 'Unknown' ||
        Boolean(session.locationHint),
    },
    {
      id: 'gap_evidence',
      label: 'Decision papers',
      priority: 45,
      kind: 'closed',
      reason: 'Refusal letter anchors the official cause.',
      filled: answered(session, 'gap_evidence') || session.documents.length > 0,
    },
    {
      id: 'gap_goal',
      label: 'Desired outcome',
      priority: 20,
      kind: 'closed',
      reason: 'Asked after refusal causation is sketched.',
      filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
    },
  ]
}

function genericGaps(session: SessionState): CausationGap[] {
  return [
    {
      id: 'gap_incident_detail',
      label: 'What exactly happened',
      priority: 100,
      kind: 'open',
      reason: 'Narrative first — then cause.',
      filled: hasRichNarrative(session),
    },
    {
      id: 'gap_breach',
      label: 'How it was caused',
      priority: 90,
      kind: 'open',
      reason: 'Client’s causal account.',
      filled: session.howCaused.trim().length >= 20 || answered(session, 'gap_breach'),
    },
    {
      id: 'gap_responsible',
      label: 'Who was involved',
      priority: 80,
      kind: 'closed',
      reason: 'Actors in the causal chain.',
      filled: session.parties.length > 0 || answered(session, 'gap_responsible'),
    },
    {
      id: 'gap_aftermath',
      label: 'What followed',
      priority: 70,
      kind: 'open',
      reason: 'Sequence after the main event.',
      filled: session.events.length >= 2 || answered(session, 'gap_aftermath'),
    },
    {
      id: 'gap_when',
      label: 'When',
      priority: 60,
      kind: 'closed',
      reason: 'Timeline anchor.',
      filled: answered(session, 'gap_when') || session.events.some((e) => Boolean(e.dateApprox)),
    },
    {
      id: 'gap_where',
      label: 'Where',
      priority: 55,
      kind: 'closed',
      reason: 'Jurisdiction.',
      filled:
        answered(session, 'gap_where') ||
        session.jurisdiction !== 'Unknown' ||
        Boolean(session.locationHint),
    },
    {
      id: 'gap_goal',
      label: 'Desired outcome',
      priority: 20,
      kind: 'closed',
      reason: 'After the story hangs together.',
      filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
    },
  ]
}

function employmentGaps(session: SessionState): CausationGap[] {
  const c = corpus(session)
  return [
    {
      id: 'gap_incident_detail',
      label: 'What happened at work',
      priority: 100,
      kind: 'open',
      reason: 'Need the work story before rights pathways.',
      filled: hasRichNarrative(session),
    },
    {
      id: 'gap_responsible',
      label: 'Employer / workplace',
      priority: 90,
      kind: 'closed',
      reason: 'Employer attribution.',
      filled:
        answered(session, 'gap_responsible') ||
        hasPartyRole(session, 'employer') ||
        /employer|boss|company|manager/.test(c),
    },
    {
      id: 'gap_breach',
      label: 'What went wrong',
      priority: 85,
      kind: 'open',
      reason: 'Dismissal, pay, or other failure.',
      filled: answered(session, 'gap_breach') || session.howCaused.trim().length >= 20,
    },
    {
      id: 'gap_when',
      label: 'When',
      priority: 70,
      kind: 'closed',
      reason: 'Limitation / early conciliation timing.',
      filled: answered(session, 'gap_when') || session.events.some((e) => Boolean(e.dateApprox)),
    },
    {
      id: 'gap_evidence',
      label: 'Contract / payslips / letters',
      priority: 50,
      kind: 'closed',
      reason: 'Employment documents support the story.',
      filled: answered(session, 'gap_evidence') || session.documents.length > 0,
    },
    {
      id: 'gap_where',
      label: 'Where you work / live',
      priority: 45,
      kind: 'closed',
      reason: 'Jurisdiction for employment pathways.',
      filled:
        answered(session, 'gap_where') ||
        session.jurisdiction !== 'Unknown' ||
        Boolean(session.locationHint),
    },
    {
      id: 'gap_goal',
      label: 'Desired outcome',
      priority: 20,
      kind: 'closed',
      reason: 'After the work story is usable.',
      filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
    },
  ]
}

function debtGaps(session: SessionState): CausationGap[] {
  const c = corpus(session)
  return [
    {
      id: 'gap_incident_detail',
      label: 'What debt problem',
      priority: 100,
      kind: 'open',
      reason: 'Need the debt story and stage.',
      filled: hasRichNarrative(session),
    },
    {
      id: 'gap_breach',
      label: 'What you owe / who is chasing',
      priority: 88,
      kind: 'open',
      reason: 'Creditor and amount frame next steps.',
      filled: answered(session, 'gap_breach') || session.howCaused.trim().length >= 15 || /£|\d+/.test(c),
    },
    {
      id: 'gap_when',
      label: 'When enforcement started',
      priority: 70,
      kind: 'closed',
      reason: 'Stage timing.',
      filled: answered(session, 'gap_when') || session.events.some((e) => Boolean(e.dateApprox)),
    },
    {
      id: 'gap_evidence',
      label: 'Letters / CCJ papers',
      priority: 50,
      kind: 'closed',
      reason: 'Papers show the enforcement stage.',
      filled: answered(session, 'gap_evidence') || session.documents.length > 0,
    },
    {
      id: 'gap_where',
      label: 'Where you are based',
      priority: 45,
      kind: 'closed',
      reason: 'Jurisdiction for debt advice.',
      filled:
        answered(session, 'gap_where') ||
        session.jurisdiction !== 'Unknown' ||
        Boolean(session.locationHint),
    },
    {
      id: 'gap_goal',
      label: 'Desired outcome',
      priority: 20,
      kind: 'closed',
      reason: 'Stop enforcement, affordability, or advice.',
      filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
    },
  ]
}

function familyGaps(session: SessionState): CausationGap[] {
  const c = corpus(session)
  return [
    {
      id: 'gap_incident_detail',
      label: 'What is happening in the family',
      priority: 100,
      kind: 'open',
      reason: 'Need the family story before pathways.',
      filled: hasRichNarrative(session),
    },
    {
      id: 'gap_responsible',
      label: 'Who is involved',
      priority: 88,
      kind: 'closed',
      reason: 'Other parent / partner attribution.',
      filled: answered(session, 'gap_responsible') || session.parties.length > 0 || /partner|ex|mother|father/.test(c),
    },
    {
      id: 'gap_when',
      label: 'When this started',
      priority: 65,
      kind: 'closed',
      reason: 'Timeline for urgent vs planned routes.',
      filled: answered(session, 'gap_when') || session.events.some((e) => Boolean(e.dateApprox)),
    },
    {
      id: 'gap_where',
      label: 'Where you and the children are',
      priority: 55,
      kind: 'closed',
      reason: 'Jurisdiction for family courts / support.',
      filled:
        answered(session, 'gap_where') ||
        session.jurisdiction !== 'Unknown' ||
        Boolean(session.locationHint),
    },
    {
      id: 'gap_evidence',
      label: 'Orders / messages / police reports',
      priority: 40,
      kind: 'closed',
      reason: 'Evidence supports arrangements or safety.',
      filled: answered(session, 'gap_evidence') || session.documents.length > 0,
    },
    {
      id: 'gap_goal',
      label: 'Desired outcome',
      priority: 20,
      kind: 'closed',
      reason: 'Contact, divorce, or safety outcome.',
      filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
    },
  ]
}

function consumerGaps(session: SessionState): CausationGap[] {
  const c = corpus(session)
  return [
    {
      id: 'gap_incident_detail',
      label: 'What you bought / what went wrong',
      priority: 100,
      kind: 'open',
      reason: 'Need the purchase story.',
      filled: hasRichNarrative(session),
    },
    {
      id: 'gap_responsible',
      label: 'Which trader',
      priority: 88,
      kind: 'closed',
      reason: 'Trader identity for consumer rights.',
      filled: answered(session, 'gap_responsible') || /trader|shop|garage|company|seller|amazon|ebay/.test(c),
    },
    {
      id: 'gap_breach',
      label: 'What they refused / failed to do',
      priority: 85,
      kind: 'open',
      reason: 'Refund, repair, or replacement failure.',
      filled: answered(session, 'gap_breach') || session.howCaused.trim().length >= 15,
    },
    {
      id: 'gap_when',
      label: 'When you bought / complained',
      priority: 65,
      kind: 'closed',
      reason: 'Consumer time limits.',
      filled: answered(session, 'gap_when') || session.events.some((e) => Boolean(e.dateApprox)),
    },
    {
      id: 'gap_evidence',
      label: 'Receipt / order confirmation',
      priority: 50,
      kind: 'closed',
      reason: 'Proof of purchase.',
      filled: answered(session, 'gap_evidence') || session.documents.length > 0,
    },
    {
      id: 'gap_where',
      label: 'Where you are based',
      priority: 40,
      kind: 'closed',
      reason: 'Jurisdiction for consumer pathways.',
      filled:
        answered(session, 'gap_where') ||
        session.jurisdiction !== 'Unknown' ||
        Boolean(session.locationHint),
    },
    {
      id: 'gap_goal',
      label: 'Desired outcome',
      priority: 20,
      kind: 'closed',
      reason: 'Refund, repair, or replacement.',
      filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
    },
  ]
}

export function listCausationGaps(session: SessionState): CausationGap[] {
  if (session.mode === 'browse' || session.matterType === 'conveyancing') {
    return [
      {
        id: 'gap_where',
        label: 'Location',
        priority: 80,
        kind: 'closed',
        reason: 'Need place to show local services.',
        filled:
          answered(session, 'gap_where') ||
          session.jurisdiction !== 'Unknown' ||
          Boolean(session.locationHint),
      },
      {
        id: 'gap_goal',
        label: 'What you need',
        priority: 50,
        kind: 'closed',
        reason: 'Confirm the service goal.',
        filled: answered(session, 'gap_goal') || session.goal.trim().length > 0,
      },
    ]
  }

  switch (session.matterType) {
    case 'personal_injury':
      return piGaps(session)
    case 'housing':
      return housingGaps(session)
    case 'immigration':
      return immigrationGaps(session)
    case 'employment':
      return employmentGaps(session)
    case 'debt':
      return debtGaps(session)
    case 'family':
      return familyGaps(session)
    case 'consumer':
      return consumerGaps(session)
    default:
      return genericGaps(session)
  }
}

export function openCausationGaps(session: SessionState): CausationGap[] {
  return listCausationGaps(session)
    .filter((g) => !g.filled)
    .sort((a, b) => b.priority - a.priority)
}

export function buildQuestionForGap(session: SessionState, gap: CausationGap): CausationQuestion {
  const ref = cite(session)
  const matter: MatterType = session.matterType
  const c = corpus(session)
  const who = partyLabel(session)
  const cause = causeSnippet(session)
  const place = session.locationHint
  const neighbourHousing = matter === 'housing' && isNeighbourHousing(session)

  switch (gap.id) {
    case 'gap_incident_detail': {
      const hook = ref
        ? `You said “${ref}”.`
        : matter === 'personal_injury'
          ? 'You are asking about an injury.'
          : 'From what you typed so far,'
      const text =
        matter === 'personal_injury'
          ? `${hook} What exactly happened in the moment you were hurt — where were you, what were you doing, and what went wrong?`
          : neighbourHousing
            ? `${hook} Walk through the neighbour problem in order: what came first, then what happened next?`
            : matter === 'housing'
              ? `${hook} Walk through the housing problem in order: what came first, then what happened next?`
              : matter === 'immigration'
                ? `${hook} Walk through the application or refusal in order — what did you apply for, then what happened?`
                : `${hook} Walk through what happened in order, from the first event to now.`

      const options: PredictiveChoice[] =
        matter === 'personal_injury'
          ? [
              ...( /work|employer|job|workplace/.test(c)
                ? [
                    {
                      id: 'i1',
                      label: 'Hurt while doing my job tasks',
                      value: `I was hurt while doing my job tasks${ref ? ` — related to “${clip(ref, 40)}”` : ''}`,
                    },
                  ]
                : []),
              { id: 'i2', label: 'I slipped / fell there', value: `I slipped or fell${ref ? ` around “${clip(ref, 40)}”` : ''} and was injured` },
              { id: 'i3', label: 'I was hit / struck', value: `I was hit or struck${ref ? ` during “${clip(ref, 40)}”` : ''} and was injured` },
              { id: 'i4', label: 'Unsafe kit / no proper setup', value: 'I was injured because of unsafe equipment or an unsafe setup at the time' },
            ]
          : matter === 'housing'
            ? [
                { id: 'i1', label: 'Started with repairs / mould', value: 'It started with disrepair or mould, then got worse' },
                { id: 'i2', label: 'Started when I was locked out', value: 'It started when I was locked out or forced out' },
                { id: 'i3', label: 'Started with an eviction notice', value: 'It started when I received an eviction or possession notice' },
              ]
            : [
                { id: 'i1', label: 'I’ll describe the first event', value: `The first thing that happened was connected to “${clip(ref || 'my situation', 40)}” — I will describe it in order` },
              ]

      return { id: gap.id, gapId: gap.id, kind: 'open', reason: gap.reason, text, options }
    }

    case 'gap_mechanism': {
      const text = ref
        ? `When “${ref}” happened — what physically caused the injury in that moment (slip, impact, equipment, lifting, something else)?`
        : 'What physically caused the injury in that moment (slip, impact, equipment, lifting, something else)?'
      return {
        id: gap.id,
        gapId: gap.id,
        kind: gap.kind,
        reason: gap.reason,
        text,
        options: [
          { id: 'm1', label: 'Slip / trip / fall', value: `I slipped, tripped, or fell${ref ? ` during “${clip(ref, 36)}”` : ''}` },
          { id: 'm2', label: 'Hit by object / person', value: `I was hit by an object or person${ref ? ` during “${clip(ref, 36)}”` : ''}` },
          { id: 'm3', label: 'Faulty equipment', value: `Faulty equipment caused the injury${ref ? ` during “${clip(ref, 36)}”` : ''}` },
          { id: 'm4', label: 'Lifting / strain', value: `Lifting or strain caused the injury${ref ? ` during “${clip(ref, 36)}”` : ''}` },
        ],
      }
    }

    case 'gap_responsible': {
      const text = neighbourHousing
        ? ref
          ? `For “${ref}” — who is mainly causing this: your neighbour, someone else, or are you not sure?`
          : 'Who is mainly causing this neighbour problem: your neighbour, someone else, or are you not sure?'
        : matter === 'housing'
          ? ref
            ? `For “${ref}” — who do you say mainly caused or allowed this: landlord, letting agent, both, or someone else?`
            : 'Who do you say mainly caused or allowed this housing problem: landlord, letting agent, both, or someone else?'
          : ref
            ? `For “${ref}”${cause ? ` (you mentioned “${cause}”)` : ''} — who do you say may be responsible?`
            : 'Who do you say may be responsible for what happened?'

      const options: PredictiveChoice[] = neighbourHousing
        ? [
            {
              id: 'r1',
              label: 'My neighbour',
              value: `My neighbour is mainly responsible for “${clip(ref || 'this problem', 40)}”`,
            },
            {
              id: 'r2',
              label: 'Someone else',
              value: `Someone other than my neighbour may be responsible for “${clip(ref || 'this problem', 40)}”`,
            },
            {
              id: 'r3',
              label: 'Not sure yet',
              value: `I am not sure who is responsible for “${clip(ref || 'this problem', 40)}” yet`,
            },
          ]
        : matter === 'housing'
          ? [
              { id: 'r1', label: 'My landlord', value: `My landlord is mainly responsible for “${clip(ref || 'this housing problem', 40)}”` },
              { id: 'r2', label: 'Letting agent', value: `The letting agent is mainly responsible for “${clip(ref || 'this housing problem', 40)}”` },
              { id: 'r3', label: 'Both', value: 'Both the landlord and letting agent may be responsible' },
              { id: 'r4', label: 'Someone else / not sure', value: 'Someone else may be responsible — or I am not sure yet' },
            ]
          : [
              ...(/work|employer|job|workplace/.test(c) || matter === 'personal_injury'
                ? [{ id: 'r1', label: 'My employer', value: `My employer may be responsible for “${clip(ref || 'the injury', 40)}”` }]
                : []),
              { id: 'r2', label: 'Another company on site', value: `Another company on site may be responsible for “${clip(ref || 'the injury', 40)}”` },
              ...(who
                ? [{ id: 'r3', label: `Not ${who}`, value: `Someone other than ${who} may be responsible` }]
                : [{ id: 'r3', label: 'A named person', value: 'A particular person may be responsible — I can name them' }]),
              { id: 'r4', label: 'Not sure yet', value: `I am not sure who is responsible for “${clip(ref || 'what happened', 40)}” yet` },
            ]

      return { id: gap.id, gapId: gap.id, kind: 'closed', reason: gap.reason, text, options }
    }

    case 'gap_breach': {
      const actor =
        matter === 'housing'
          ? housingActor(session)
          : who || (/employer|work/.test(c) ? 'my employer' : 'they')
      const text = ref
        ? `You described “${ref}”. What exactly do you say ${actor} failed to do — or did wrong — that led to this?`
        : `What exactly do you say ${actor} failed to do — or did wrong — that led to this?`
      const options: PredictiveChoice[] =
        matter === 'personal_injury'
          ? [
              { id: 'b1', label: 'No safe system of work', value: `${actor} did not have a safe system of work for “${clip(ref || 'the task', 36)}”` },
              { id: 'b2', label: 'No training / warning', value: `${actor} did not give proper training or warning before “${clip(ref || 'the incident', 36)}”` },
              { id: 'b3', label: 'Known hazard left unfixed', value: `${actor} left a known hazard unfixed that led to “${clip(ref || 'the injury', 36)}”` },
            ]
          : neighbourHousing
            ? [
                {
                  id: 'b1',
                  label: 'Keeps parking / blocking access',
                  value: `${actor} keeps parking on or blocking my driveway or access`,
                },
                {
                  id: 'b2',
                  label: 'Ignored my requests',
                  value: `${actor} ignored my requests to stop “${clip(ref || 'this', 36)}”`,
                },
                {
                  id: 'b3',
                  label: 'Damaged property / boundary',
                  value: `${actor} damaged my property or crossed a boundary`,
                },
              ]
            : matter === 'housing'
              ? [
                  { id: 'b1', label: 'Failed to repair', value: `${actor} failed to repair the problem after I raised it` },
                  { id: 'b2', label: 'Ignored my complaints', value: `${actor} ignored my complaints about “${clip(ref || 'the property', 36)}”` },
                  { id: 'b3', label: 'Unlawful lockout / pressure', value: `${actor} locked me out or pressured me unlawfully` },
                ]
              : [
                  { id: 'b1', label: 'They failed to act', value: `${actor} failed to act when they should have about “${clip(ref || 'this', 36)}”` },
                  { id: 'b2', label: 'They caused it directly', value: `${actor} directly caused “${clip(ref || 'this', 36)}”` },
                ]
      return { id: gap.id, gapId: gap.id, kind: 'open', reason: gap.reason, text, options }
    }

    case 'gap_employer_duty': {
      const text = ref
        ? `At the time of “${ref}”, what was your relationship to the workplace — employee, agency worker, contractor, or visitor?`
        : 'At the time of the injury, what was your relationship to the workplace — employee, agency worker, contractor, or visitor?'
      return {
        id: gap.id,
        gapId: gap.id,
        kind: 'closed',
        reason: gap.reason,
        text,
        options: [
          { id: 'e1', label: 'Employee', value: `I was an employee when “${clip(ref || 'the injury', 40)}” happened` },
          { id: 'e2', label: 'Agency / temporary', value: `I was an agency or temporary worker when “${clip(ref || 'the injury', 40)}” happened` },
          { id: 'e3', label: 'Self-employed / contractor', value: `I was self-employed or a contractor when “${clip(ref || 'the injury', 40)}” happened` },
          { id: 'e4', label: 'Visitor / other', value: `I was a visitor or in another role when “${clip(ref || 'the injury', 40)}” happened` },
        ],
      }
    }

    case 'gap_harm': {
      const text = ref
        ? `After “${ref}”, what injury did you actually suffer (body part and type of harm)?`
        : 'What injury did you actually suffer (body part and type of harm)?'
      return {
        id: gap.id,
        gapId: gap.id,
        kind: 'open',
        reason: gap.reason,
        text,
        options: [
          { id: 'h1', label: 'Back / neck', value: `After “${clip(ref || 'the incident', 36)}” I injured my back or neck` },
          { id: 'h2', label: 'Broken bone / fracture', value: `After “${clip(ref || 'the incident', 36)}” I suffered a broken bone or fracture` },
          { id: 'h3', label: 'Head injury', value: `After “${clip(ref || 'the incident', 36)}” I suffered a head injury` },
          { id: 'h4', label: 'Other (I’ll name it)', value: `After “${clip(ref || 'the incident', 36)}” I suffered another injury — I will name it` },
        ],
      }
    }

    case 'gap_housing_trigger': {
      const text = neighbourHousing
        ? ref
          ? `Looking at “${ref}” — which of these started the problem?`
          : 'Which of these started the neighbour problem?'
        : ref
          ? `Looking at “${ref}” — which of these started the problem?`
          : 'Which of these started the housing problem?'
      return {
        id: gap.id,
        gapId: gap.id,
        kind: 'closed',
        reason: gap.reason,
        text,
        options: neighbourHousing
          ? [
              {
                id: 't1',
                label: 'Parking / driveway access',
                value: `“${clip(ref || 'The problem', 36)}” started with parking or driveway access`,
              },
              {
                id: 't2',
                label: 'Boundary / fence / hedge',
                value: `“${clip(ref || 'The problem', 36)}” started with a boundary, fence, or hedge issue`,
              },
              {
                id: 't3',
                label: 'Noise / nuisance',
                value: `“${clip(ref || 'The problem', 36)}” started with noise or nuisance`,
              },
              {
                id: 't4',
                label: 'Something else',
                value: `“${clip(ref || 'The problem', 36)}” started another way — I will explain`,
              },
            ]
          : [
              { id: 't1', label: 'Disrepair / mould', value: `“${clip(ref || 'The problem', 36)}” started with disrepair or mould` },
              { id: 't2', label: 'Rent / money dispute', value: `“${clip(ref || 'The problem', 36)}” started with a rent or money dispute` },
              { id: 't3', label: 'Eviction / notice', value: `“${clip(ref || 'The problem', 36)}” started with an eviction or possession notice` },
              { id: 't4', label: 'Lockout', value: `“${clip(ref || 'The problem', 36)}” started when I was locked out or forced out` },
            ],
      }
    }

    case 'gap_refusal_reason': {
      const text = ref
        ? `About “${ref}” — what reason did the decision letter (or Home Office) give, and what do you say actually caused the refusal?`
        : 'What reason did the decision letter (or Home Office) give, and what do you say actually caused the refusal?'
      return {
        id: gap.id,
        gapId: gap.id,
        kind: 'open',
        reason: gap.reason,
        text,
        options: [
          { id: 'rr1', label: 'Character / criminality', value: `For “${clip(ref || 'the refusal', 36)}” they raised character or criminality` },
          { id: 'rr2', label: 'Rules / eligibility not met', value: `For “${clip(ref || 'the refusal', 36)}” they said I did not meet the rules` },
          { id: 'rr3', label: 'Missing evidence', value: `For “${clip(ref || 'the refusal', 36)}” they said documents or evidence were missing` },
        ],
      }
    }

    case 'gap_character': {
      const text = /character|criminal|suitability|bad character/.test(c)
        ? `You mentioned something about character. Was “bad character”, criminality, or suitability formally raised against you in the decision?`
        : ref
          ? `In the decision about “${ref}”, was character, criminality, or suitability raised?`
          : 'In the refusal decision, was character, criminality, or suitability raised?'
      return {
        id: gap.id,
        gapId: gap.id,
        kind: 'closed',
        reason: gap.reason,
        text,
        options: [
          { id: 'c1', label: 'Yes — it was raised', value: `Yes, character or suitability was raised in “${clip(ref || 'the decision', 40)}”` },
          { id: 'c2', label: 'No', value: `No, character was not raised in “${clip(ref || 'the decision', 40)}”` },
          { id: 'c3', label: 'Not sure / letter unclear', value: 'I am not sure — the letter is unclear on character' },
        ],
      }
    }

    case 'gap_aftermath': {
      const text = ref
        ? `Straight after “${ref}”, what did you do next — and what did anyone else do?`
        : 'Straight after the main event, what did you do next — and what did anyone else do?'
      const options: PredictiveChoice[] =
        matter === 'personal_injury'
          ? [
              { id: 'a1', label: 'Reported it at work', value: `After “${clip(ref || 'the injury', 36)}” I reported it at work` },
              { id: 'a2', label: 'Saw GP / A&E', value: `After “${clip(ref || 'the injury', 36)}” I saw a GP or went to A&E` },
              { id: 'a3', label: 'Took time off', value: `After “${clip(ref || 'the injury', 36)}” I took time off work` },
              { id: 'a4', label: 'Nothing formal yet', value: `After “${clip(ref || 'the injury', 36)}” nothing formal has happened yet` },
            ]
          : [
              { id: 'a1', label: 'Another letter arrived', value: `After “${clip(ref || 'that', 36)}” I received another letter or notice` },
              { id: 'a2', label: `I contacted ${who || 'them'} again`, value: `After “${clip(ref || 'that', 36)}” I contacted ${who || 'them'} again` },
              { id: 'a3', label: 'Nothing further yet', value: `After “${clip(ref || 'that', 36)}” nothing further has happened yet` },
            ]
      return { id: gap.id, gapId: gap.id, kind: gap.kind, reason: gap.reason, text, options }
    }

    case 'gap_when': {
      const text = ref
        ? `Roughly when did “${ref}” happen?`
        : cause
          ? `Roughly when did the problem you linked to “${cause}” happen?`
          : 'Roughly when did the main event in your timeline happen?'
      return {
        id: gap.id,
        gapId: gap.id,
        kind: 'closed',
        reason: gap.reason,
        text,
        options: [
          { id: 'w1', label: 'This week', value: `“${clip(ref || 'It', 40)}” happened this week` },
          { id: 'w2', label: 'Last week', value: `“${clip(ref || 'It', 40)}” happened last week` },
          { id: 'w3', label: 'Last month', value: `“${clip(ref || 'It', 40)}” happened last month` },
          { id: 'w4', label: 'This year', value: `“${clip(ref || 'It', 40)}” happened this year` },
          { id: 'w5', label: 'Last year or earlier', value: `“${clip(ref || 'It', 40)}” happened last year or earlier` },
        ],
      }
    }

    case 'gap_where': {
      const text =
        session.mode === 'browse'
          ? ref
            ? `For “${ref}”, where do you need the service (town/city and nation)?`
            : 'Where do you need the conveyancer or service (town/city and nation)?'
          : ref
            ? `Where did “${ref}” happen${place ? ` — you mentioned ${place}; is that right, and which UK nation?` : ' (town/city and England/Wales, Scotland, or Northern Ireland)?'}`
            : 'Where did the main event happen (town/city and England/Wales, Scotland, or Northern Ireland)?'
      return {
        id: gap.id,
        gapId: gap.id,
        kind: 'closed',
        reason: gap.reason,
        text,
        options: [
          { id: 'p1', label: 'England', value: `“${clip(ref || 'This', 36)}” happened in England${place ? ` (${place})` : ''}` },
          { id: 'p2', label: 'Wales', value: `“${clip(ref || 'This', 36)}” happened in Wales` },
          { id: 'p3', label: 'Scotland', value: `“${clip(ref || 'This', 36)}” happened in Scotland` },
          { id: 'p4', label: 'Northern Ireland', value: `“${clip(ref || 'This', 36)}” happened in Northern Ireland` },
          ...(place
            ? [{ id: 'p5', label: `Yes — ${place}`, value: `Yes, this is in ${place}` }]
            : [{ id: 'p5', label: 'London', value: `“${clip(ref || 'This', 36)}” happened in London, England` }]),
        ],
      }
    }

    case 'gap_evidence': {
      const text = ref
        ? `Do you already have anything in writing about “${ref}” (report, letter, photos, messages)?`
        : 'Do you already have anything in writing about this (report, letter, photos, messages)?'
      const options: PredictiveChoice[] =
        matter === 'personal_injury'
          ? [
              { id: 'd1', label: 'Accident report', value: `I have an accident report about “${clip(ref || 'the injury', 36)}”` },
              { id: 'd2', label: 'Medical notes', value: `I have medical notes about “${clip(ref || 'the injury', 36)}”` },
              { id: 'd3', label: 'Photos / messages', value: `I have photos or messages about “${clip(ref || 'the injury', 36)}”` },
              { id: 'd4', label: 'Nothing yet', value: `I have no documents yet about “${clip(ref || 'the injury', 36)}”` },
            ]
          : matter === 'immigration'
            ? [
                { id: 'd1', label: 'Refusal / decision letter', value: `I have the refusal or decision letter about “${clip(ref || 'my application', 36)}”` },
                { id: 'd2', label: 'Application papers', value: `I have application papers about “${clip(ref || 'my application', 36)}”` },
                { id: 'd3', label: 'Nothing yet', value: 'I have no documents to hand yet' },
              ]
            : [
                { id: 'd1', label: 'Official letter / notice', value: `I have an official letter or notice about “${clip(ref || 'this', 36)}”` },
                { id: 'd2', label: 'Tenancy / contract', value: `I have a tenancy or contract about “${clip(ref || 'this', 36)}”` },
                { id: 'd3', label: 'Messages', value: `I have messages about “${clip(ref || 'this', 36)}”` },
                { id: 'd4', label: 'Nothing yet', value: 'I have no documents yet' },
              ]
      return { id: gap.id, gapId: gap.id, kind: 'closed', reason: gap.reason, text, options }
    }

    case 'gap_goal': {
      const storyBit = cause || ref
      const text = storyBit
        ? `Given “${storyBit}”${who ? ` and ${who}` : ''}, what do you want a lawyer or adviser to help you achieve next?`
        : 'What do you want a lawyer or adviser to help you achieve next?'
      const options: PredictiveChoice[] =
        matter === 'personal_injury'
          ? [
              { id: 'g1', label: 'See if I have a claim', value: `I want to see if I have a claim about “${clip(storyBit || 'the injury', 40)}”` },
              { id: 'g2', label: 'Speak to a PI lawyer', value: `I want to speak to a personal injury lawyer about “${clip(storyBit || 'the injury', 40)}”` },
              { id: 'g3', label: 'Understand my options', value: `I want to understand my options after “${clip(storyBit || 'the injury', 40)}”` },
            ]
          : matter === 'conveyancing' || session.mode === 'browse'
            ? [
                { id: 'g1', label: 'Find a conveyancer', value: `I want to find a conveyancer${place ? ` in ${place}` : ''}` },
                { id: 'g2', label: 'Compare quotes', value: `I want to compare conveyancing quotes${place ? ` in ${place}` : ''}` },
              ]
            : [
                { id: 'g1', label: 'Speak to a solicitor', value: `I want to speak to a solicitor about “${clip(storyBit || 'my situation', 40)}”` },
                { id: 'g2', label: 'Understand my options', value: `I want to understand my options about “${clip(storyBit || 'my situation', 40)}”` },
              ]
      return { id: gap.id, gapId: gap.id, kind: 'closed', reason: gap.reason, text, options }
    }

    default: {
      // Still grounded — never a bare "tell me more"
      const text = ref
        ? `About “${ref}”: what detail is still missing that a lawyer would need to understand how this was caused?`
        : mustGround('What detail is still missing that a lawyer would need to understand how this was caused?', session)
      return {
        id: gap.id,
        gapId: gap.id,
        kind: 'open',
        reason: gap.reason,
        text,
        options: [
          {
            id: 'x1',
            label: 'I’ll add the missing cause detail',
            value: `About “${clip(ref || 'my situation', 40)}”, the missing cause detail is — `,
          },
        ],
      }
    }
  }
}

/** Pick the highest-priority unfilled causation gap and build an open or closed question. */
export function nextCausationQuestion(session: SessionState): CausationQuestion | null {
  const gaps = openCausationGaps(session)
  if (gaps.length === 0) return null
  return buildQuestionForGap(session, gaps[0])
}

export function causationProgress(session: SessionState): number {
  const gaps = listCausationGaps(session)
  if (gaps.length === 0) return 100
  const filled = gaps.filter((g) => g.filled).length
  return Math.round((filled / gaps.length) * 100)
}
