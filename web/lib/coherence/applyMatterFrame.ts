import { resolveMatterFrame } from '@/lib/matter/resolve'
import { evaluateMatterGate } from '@/lib/matter/matter-gate'
import { formatMatterInspector, type MatterInspectorView } from '@/lib/matter/inspector'
import { toSessionMatterFrame } from './matterFrame'
import type { MatterFrame } from '@/lib/matter/types'
import type { Prompt, SessionState, TimelineEvent } from './types'
import { applyFrameRoutingToSession } from './issueRouting'
import { compressLiveGoal, extractClientQuestions } from './clientQuestions'
import {
  applyCommittedHypothesisToFrame,
  buildHypothesisSet,
  nextHypothesisProbe,
  shouldCommitHypothesisSet,
  type HypothesisSet,
} from './hypothesisProbe'

export { compressLiveGoal, extractClientQuestions }

const uid = () => Math.random().toString(36).slice(2, 10)

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

function sessionFromFrame(
  session: SessionState,
  frame: MatterFrame,
  latestText: string,
): SessionState {
  const questions = extractClientQuestions(
    `${storyForResolve(session, latestText)}\n${session.clientQuestion || ''}`,
  )
  const role = userCapacityRole(frame)
  let next: SessionState = {
    ...session,
    matterFrame: toSessionMatterFrame(frame),
    clientQuestion:
      compressLiveGoal(`${storyForResolve(session, latestText)}\n${session.clientQuestion || ''}`) ||
      questions[0] ||
      session.clientQuestion,
    events: eventsFromFrame(frame, session.events),
    confirmedUserRole: role === 'unset' ? session.confirmedUserRole : role,
  }
  next = applyFrameRoutingToSession(next)
  return next
}

export function attachResolvedMatterFrame(
  session: SessionState,
  latestText = '',
): {
  session: SessionState
  frame: MatterFrame
  inspector: MatterInspectorView
  hypothesisSet: HypothesisSet
} {
  const story = storyForResolve(session, latestText)
  const questions = extractClientQuestions(`${story}\n${session.clientQuestion || ''}`)
  const resolveResult = resolveMatterFrame({
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
  })
  const frame = resolveResult.frame
  const hypothesisSet = buildHypothesisSet(resolveResult, session, story)
  const alreadyCommitted = session.hypothesisProbe?.status === 'committed'
  const ready = alreadyCommitted || shouldCommitHypothesisSet(hypothesisSet)

  let next: SessionState
  if (ready) {
    const setForCommit = alreadyCommitted && session.hypothesisProbe?.set
      ? (session.hypothesisProbe.set as HypothesisSet)
      : hypothesisSet
    // Auto-commit without a user pick keeps resolve geometry (dual-capacity divorce+PAYE,
    // workplace flip, etc.). Probe answers / max-turn force use the hypothesis winner.
    const forceHypothesis =
      Boolean(setForCommit.selectedSlug) || setForCommit.turns >= 1 || alreadyCommitted
    const committedFrame = forceHypothesis
      ? applyCommittedHypothesisToFrame(frame, setForCommit)
      : frame
    next = sessionFromFrame(session, committedFrame, latestText)
    next = {
      ...next,
      hypothesisProbe: {
        set: setForCommit,
        status: 'committed',
        turns: setForCommit.turns,
      },
    }
    return {
      session: next,
      frame: committedFrame,
      inspector: formatMatterInspector(committedFrame),
      hypothesisSet: setForCommit,
    }
  }

  // Provisional frame for UI, but keep probe open — do not treat as final freeze yet.
  next = {
    ...session,
    matterFrame: toSessionMatterFrame(frame),
    clientQuestion:
      compressLiveGoal(`${story}\n${session.clientQuestion || ''}`) ||
      questions[0] ||
      session.clientQuestion,
    events: eventsFromFrame(frame, session.events),
    hypothesisProbe: {
      set: hypothesisSet,
      status: 'probing',
      turns: hypothesisSet.turns,
    },
  }
  return {
    session: next,
    frame,
    inspector: formatMatterInspector(frame),
    hypothesisSet,
  }
}

/** Commit a probed hypothesis set onto the session (one re-freeze before Penumbra). */
export function commitHypothesisProbeToSession(
  session: SessionState,
  set: HypothesisSet,
  latestText = '',
): { session: SessionState; frame: MatterFrame; inspector: MatterInspectorView } {
  const baseFrame = resolveFrameForSession(session, latestText)
  const frame = applyCommittedHypothesisToFrame(baseFrame, set)
  let next = sessionFromFrame(session, frame, latestText)
  next = {
    ...next,
    hypothesisProbe: {
      set,
      status: 'committed',
      turns: set.turns,
    },
  }
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

const SLUG_LABEL: Record<string, string> = {
  employment: 'employment / workplace rules',
  family: 'family / children',
  housing: 'housing / tenancy',
  crime: 'crime / police',
  debt: 'debt / money owed',
  consumer: 'consumer / goods',
}

export function matterGatePrompt(session: SessionState): Prompt {
  const probe = session.hypothesisProbe
  if (probe?.status === 'probing') {
    const fromProbe = nextHypothesisProbe(probe.set, session)
    if (fromProbe) return fromProbe
  }

  const gate = sessionMatterGate(session)
  const blocking = session.matterFrame?.ambiguities?.find((a) => a.blocking)
  const competitors = probe?.set.hypotheses?.length
    ? probe.set.hypotheses
    : [
        ...(session.matterFrame?.primaryIssues || []),
        ...(session.matterFrame?.secondaryIssues || []),
      ].map((issue) => ({
        slug: issue.slug,
        score: (issue.confidence || 0.4) * 40,
        why: [issue.reason || 'frame issue'],
        evidence: [] as Array<{ title: string; support: 'support' | 'contradict' | 'neutral' }>,
      }))

  const question =
    competitors.length >= 2
      ? `Is this mainly about ${SLUG_LABEL[competitors[0]!.slug] || competitors[0]!.slug.replace(/_/g, ' ')}, or ${SLUG_LABEL[competitors[1]!.slug] || competitors[1]!.slug.replace(/_/g, ' ')}?`
      : blocking?.question ||
        gate.blockingAmbiguities[0] ||
        'Which legal issues should we keep in play before researching?'

  const options = [
    ...competitors.slice(0, 3).map((h, i) => ({
      id: `hyp-${h.slug}-${i}`,
      label: `Mainly ${SLUG_LABEL[h.slug] || h.slug.replace(/_/g, ' ')}`,
      value: `This is mainly about ${h.slug}`,
    })),
    {
      id: 'hyp-unsure',
      label: 'Not sure — ask another question',
      value: 'Not sure which area — ask another discriminating question.',
    },
  ]

  return {
    id: competitors.length >= 2 ? 'hyp_probe_gate' : 'matter_gate',
    kind: 'closed',
    text: question,
    reason:
      blocking?.whyItMatters ||
      'Competing legal areas — pick the live dispute so research stays on the right geometry.',
    options,
  }
}
