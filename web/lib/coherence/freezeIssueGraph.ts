/**
 * One frozen issue graph per session.
 * Downstream search must consume this graph — not re-classify the novel every turn.
 * Research dialogue may still probe; commit can update the graph once.
 */
import { resolveMatterFrame } from '@/lib/matter/resolve'
import type { MatterFrame, MatterIssue } from '@/lib/matter/types'
import { extractClientQuestions } from './clientQuestions'
import { applyFrameRoutingToSession } from './issueRouting'
import { toSessionMatterFrame } from './matterFrame'
import { classifyUkTaxonomy } from './ukTaxonomy'
import type { SessionState } from './types'

export function isIssueGraphFrozen(session: SessionState): boolean {
  return Boolean(session.issueGraphFrozen && session.matterFrame?.primaryIssues?.length)
}

function storyBlob(session: SessionState, latest = ''): string {
  return [session.whatHappened, ...session.rawInputs.slice(-3), session.goal, session.clientQuestion, latest]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join('\n')
}

function isCrimeSlug(slug: string): boolean {
  return /crime|criminal|police/.test(slug)
}

function isHousingSlug(slug: string): boolean {
  return /housing|possession|neighbour|tenancy|homeless/.test(slug)
}

function preferMixedPrimary(frame: MatterFrame, session: SessionState, story: string): MatterFrame {
  const tax = classifyUkTaxonomy(story)
  const reasons = tax?.reasons || []
  const police = reasons.some((r) => /police|criminal/i.test(r))
  const housingCue =
    reasons.some((r) => /possession|landlord|tenancy|homeless/i.test(r)) || session.matterType === 'housing'
  const primary = frame.primaryIssues[0]
  let next = frame

  if (housingCue && police && primary && isCrimeSlug(primary.slug)) {
    const housingIssue: MatterIssue =
      [...frame.secondaryIssues].find((i) => isHousingSlug(i.slug)) || {
        slug: 'housing',
        confidence: 0.86,
        reason: 'Mixed possession/lockout with police attendance — freeze housing as primary',
      }
    next = {
      ...frame,
      primaryIssues: [housingIssue],
      secondaryIssues: [primary, ...frame.secondaryIssues.filter((i) => i.slug !== housingIssue.slug)],
      retrievalScope: Array.from(new Set(['housing', 'crime', ...(frame.retrievalScope || [])])),
    }
  }

  const slugs = new Set([...next.primaryIssues, ...next.secondaryIssues].map((i) => i.slug))
  if (police && !slugs.has('crime') && next.primaryIssues[0]?.slug !== 'crime') {
    const extra: MatterIssue = {
      slug: 'crime',
      confidence: 0.68,
      reason: 'Police attendance on a mixed dispute — secondary, not a rewrite of the primary issue',
    }
    next = {
      ...next,
      secondaryIssues: [...next.secondaryIssues, extra],
      retrievalScope: Array.from(new Set([...(next.retrievalScope || []), 'crime'])),
    }
  }
  return next
}

function resolveFrame(session: SessionState, latestText: string): MatterFrame {
  const story = storyBlob(session, latestText)
  const questions = extractClientQuestions(`${story}\n${session.clientQuestion || ''}`)
  const stampHousing =
    session.matterType === 'housing' ||
    (classifyUkTaxonomy(story)?.reasons || []).some((r) => /possession|landlord|tenancy/i.test(r))
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
    classify: {
      matterType: stampHousing ? 'housing' : session.matterType,
      topicId: session.topicId,
      taxonomySlug:
        session.taxonomySlug ||
        (stampHousing ? 'housing' : session.matterType !== 'unknown' ? session.matterType : undefined),
    },
  }).frame
}

/** Snapshot classify + matter resolve. No-op if already frozen. */
export function freezeIssueGraph(session: SessionState, latestText = ''): SessionState {
  if (isIssueGraphFrozen(session)) {
    return applyFrameRoutingToSession(session)
  }
  const story = storyBlob(session, latestText)
  const frame = preferMixedPrimary(resolveFrame(session, latestText), session, story)
  const next: SessionState = {
    ...session,
    matterFrame: toSessionMatterFrame(frame),
    issueGraphFrozen: true,
  }
  return applyFrameRoutingToSession(next)
}
