import { resolveMatterFrame } from '@/lib/matter/resolve'
import { evaluateMatterGate } from '@/lib/matter/matter-gate'
import { formatMatterInspector, type MatterInspectorView } from '@/lib/matter/inspector'
import { toSessionMatterFrame } from './matterFrame'
import type { MatterFrame } from '@/lib/matter/types'
import type { Prompt, SessionState, TimelineEvent } from './types'
import { applyFrameRoutingToSession } from './issueRouting'
import { compressLiveGoal, extractClientQuestions } from './clientQuestions'
import { type HypothesisSet, nextHypothesisProbe } from './hypothesisProbe'
import {
  commitDialogueToFrame,
  fromHypothesisProbeCompat,
  seedResearchDialogue,
  toHypothesisProbeCompat,
  type ResearchDialogueState,
} from './researchDialogue'

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

function syncDialogueFields(
  session: SessionState,
  dialogue: ResearchDialogueState,
): SessionState {
  return {
    ...session,
    researchDialogue: dialogue,
    hypothesisProbe: toHypothesisProbeCompat(dialogue),
  }
}

export function attachResolvedMatterFrame(
  session: SessionState,
  latestText = '',
): {
  session: SessionState
  frame: MatterFrame
  inspector: MatterInspectorView
  hypothesisSet: HypothesisSet
  researchDialogue: ResearchDialogueState
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
  const alreadyCommitted =
    session.researchDialogue?.status === 'committed' ||
    session.hypothesisProbe?.status === 'committed'

  if (alreadyCommitted) {
    const prior =
      session.researchDialogue ||
      (session.hypothesisProbe
        ? fromHypothesisProbeCompat(session.hypothesisProbe)
        : seedResearchDialogue(resolveResult, session, story))
    const committedFrame = commitDialogueToFrame(frame, { ...prior, status: 'committed' })
    let next = sessionFromFrame(session, committedFrame, latestText)
    const dialogue: ResearchDialogueState = { ...prior, status: 'committed' }
    next = syncDialogueFields(next, dialogue)
    return {
      session: next,
      frame: committedFrame,
      inspector: formatMatterInspector(committedFrame),
      hypothesisSet: dialogue.set,
      researchDialogue: dialogue,
    }
  }

  // Late freeze: always start/keep active dialogue — never auto-commit on first attach.
  const dialogue = seedResearchDialogue(resolveResult, session, story)
  // Soft-route from provisional resolve geometry for Matching Help preview; Penumbra waits.
  let next = sessionFromFrame(session, frame, latestText)
  next = {
    ...next,
    clientQuestion:
      compressLiveGoal(`${story}\n${session.clientQuestion || ''}`) ||
      questions[0] ||
      session.clientQuestion,
    events: eventsFromFrame(frame, session.events),
  }
  next = syncDialogueFields(next, dialogue)

  return {
    session: next,
    frame,
    inspector: formatMatterInspector(frame),
    hypothesisSet: dialogue.set,
    researchDialogue: dialogue,
  }
}

/** Commit research dialogue onto the session (one freeze before Penumbra Exa). */
export function commitHypothesisProbeToSession(
  session: SessionState,
  set: HypothesisSet,
  latestText = '',
): { session: SessionState; frame: MatterFrame; inspector: MatterInspectorView } {
  const dialogue: ResearchDialogueState = {
    set,
    status: 'committed',
    turns: set.turns,
    transcript: session.researchDialogue?.transcript || [],
    lastEvidence: session.researchDialogue?.lastEvidence || [],
    statusNote: session.researchDialogue?.statusNote,
  }
  return commitResearchDialogueToSession(session, dialogue, latestText)
}

export function commitResearchDialogueToSession(
  session: SessionState,
  dialogue: ResearchDialogueState,
  latestText = '',
): { session: SessionState; frame: MatterFrame; inspector: MatterInspectorView } {
  const baseFrame = resolveFrameForSession(session, latestText)
  const frame = commitDialogueToFrame(baseFrame, dialogue)
  let next = sessionFromFrame(session, frame, latestText)
  const committed: ResearchDialogueState = { ...dialogue, status: 'committed' }
  next = syncDialogueFields(next, committed)
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
  const dialogue = session.researchDialogue
  const probe = session.hypothesisProbe
  const set = dialogue?.set || probe?.set
  if ((dialogue?.status === 'active' || probe?.status === 'probing') && set) {
    const fromProbe = nextHypothesisProbe(set as HypothesisSet, session)
    if (fromProbe) return fromProbe
  }

  const gate = sessionMatterGate(session)
  const blocking = session.matterFrame?.ambiguities?.find((a) => a.blocking)
  const competitors = set?.hypotheses?.length
    ? set.hypotheses
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
