import { resolveMatterFrame } from '@/lib/matter/resolve'
import { evaluateMatterGate } from '@/lib/matter/matter-gate'
import { formatMatterInspector, type MatterInspectorView } from '@/lib/matter/inspector'
import { toSessionMatterFrame } from './matterFrame'
import type { MatterFrame } from '@/lib/matter/types'
import type { Prompt, SessionState, TimelineEvent } from './types'
import { applyFrameRoutingToSession } from './issueRouting'

const uid = () => Math.random().toString(36).slice(2, 10)

/** Split a story into the questions the client actually asked, plus implied next-step asks. */
export function extractClientQuestions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const raw = String(text || '')
  const pieces = raw
    .split(/(?<=[?])/g)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.includes('?') && p.length >= 12 && p.length <= 400)
  for (const p of pieces) {
    const key = p.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  const implied: Array<{ re: RegExp; q: string }> = [
    { re: /next step|some advice|what (?:can|should) i do/i, q: 'What should I do next to stay safe and housed?' },
    { re: /right to stay|no tenancy|tied/i, q: 'Do I have a right to stay without a written tenancy?' },
    {
      re: /door (?:had been )?removed|changed? (?:the )?locks?|leave immediately|forced .{0,40}(?:leave|vacate)|no front door/i,
      q: 'What can I do after being locked out or forced to leave without a court order?',
    },
    { re: /wages|holiday pay/i, q: 'Can wages or holiday pay be withheld until I leave?' },
    {
      re: /nowhere else|homeless|tonight|emergency (?:housing|alternative)|sofa to crash/i,
      q: 'Where can I get emergency housing tonight?',
    },
  ]
  for (const item of implied) {
    if (!item.re.test(raw)) continue
    const key = item.q.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item.q)
  }
  return out.slice(0, 6)
}

function storyForResolve(session: SessionState, latest = ''): string {
  return [session.whatHappened, ...session.rawInputs.slice(-3), session.goal, latest]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join('\n')
}

function userCapacityRole(frame: MatterFrame): SessionState['confirmedUserRole'] {
  const caps = frame.capacities.filter((c) => c.partyId === 'user')
  if (caps.some((c) => c.capacity === 'employer' || c.capacity === 'company')) return 'employer'
  if (caps.some((c) => c.capacity === 'employee')) return 'employee'
  if (caps.some((c) => c.capacity === 'tenant')) return 'tenant'
  if (caps.some((c) => c.capacity === 'landlord')) return 'landlord'
  if (caps.some((c) => c.capacity === 'consumer' || c.capacity === 'buyer')) return 'consumer'
  return 'unset'
}

function eventsFromFrame(frame: MatterFrame, existing: TimelineEvent[]): TimelineEvent[] {
  const fromFrame: TimelineEvent[] = frame.events
    .filter((e) => e.description?.trim())
    .map((e) => ({
      id: e.id || uid(),
      label: e.description.slice(0, 78),
      rawSpan: e.fact || e.description,
      dateApprox: e.dateApprox,
      kind: 'event' as const,
    }))
  if (fromFrame.length < 2) return existing
  if (existing.filter((e) => e.kind === 'event').length >= fromFrame.length) return existing
  const start = existing.find((e) => e.kind === 'start')
  return start ? [start, ...fromFrame] : fromFrame
}

export function resolveFrameForSession(session: SessionState, latestText = ''): MatterFrame {
  const story = storyForResolve(session, latestText)
  const questions = extractClientQuestions(`${story}\n${session.clientQuestion || ''}`)
  return resolveMatterFrame({
    submission: session.whatHappened?.trim() || story,
    clientQuestion: questions.join(' ') || session.clientQuestion,
    understanding: session.briefUnderstanding,
    jurisdictionHint: session.locationHint,
    brief: {
      goal: session.goal,
      whatHappened: session.whatHappened,
      clientQuestion: session.clientQuestion,
      events: session.events.map((e) => ({
        label: e.label,
        rawSpan: e.rawSpan || e.label,
        dateApprox: e.dateApprox,
      })),
      parties: session.parties,
    },
  }).frame
}

export function attachResolvedMatterFrame(
  session: SessionState,
  latestText = '',
): { session: SessionState; frame: MatterFrame; inspector: MatterInspectorView } {
  const frame = resolveFrameForSession(session, latestText)
  const questions = extractClientQuestions(
    `${storyForResolve(session, latestText)}\n${session.clientQuestion || ''}`,
  )
  const role = userCapacityRole(frame)
  let next: SessionState = {
    ...session,
    matterFrame: toSessionMatterFrame(frame),
    clientQuestion: questions.join(' ') || session.clientQuestion,
    events: eventsFromFrame(frame, session.events),
    confirmedUserRole: role === 'unset' ? session.confirmedUserRole : role,
  }
  next = applyFrameRoutingToSession(next)
  return { session: next, frame, inspector: formatMatterInspector(frame) }
}

export function sessionMatterGate(session: SessionState) {
  const frame = session.matterFrame
  if (!frame) {
    return {
      status: 'needs_clarification' as const,
      reason: 'insufficient_facts',
      blockingAmbiguities: ['What happened between you and the other person?'],
    }
  }
  return evaluateMatterGate({
    resolutionStatus: frame.resolutionStatus as MatterFrame['resolutionStatus'],
    ambiguities: frame.ambiguities,
  } as MatterFrame)
}

export function matterGatePrompt(session: SessionState): Prompt {
  const gate = sessionMatterGate(session)
  const blocking = session.matterFrame?.ambiguities?.find((a) => a.blocking)
  const question =
    blocking?.question ||
    gate.blockingAmbiguities[0] ||
    'Which legal issues should we keep in play before researching?'
  const issues = [
    ...(session.matterFrame?.primaryIssues || []),
    ...(session.matterFrame?.secondaryIssues || []),
  ]
  const options = [
    {
      id: 'keep-all',
      label: 'Keep all of these issues',
      value: 'Treat this as involving all of the issues already identified.',
    },
    ...issues.slice(0, 4).map((issue, i) => ({
      id: `issue-${i}`,
      label: `Mainly ${issue.slug.replace(/_/g, ' ')}`,
      value: `This is mainly about ${issue.slug.replace(/_/g, ' ')}`,
    })),
  ]
  return {
    id: 'matter_gate',
    kind: 'closed',
    text: question,
    reason:
      blocking?.whyItMatters ||
      'Legal understanding first — retrieval and Third Eye stay scoped to the issue graph.',
    options,
  }
}
