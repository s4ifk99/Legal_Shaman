import type { SessionState } from './types'
import { causationProgress, listCausationGaps, openCausationGaps } from './causation'

export function computeProgress(session: SessionState): number {
  if (session.rawInputs.length === 0) return 0
  // Blend causation-gap fill with a floor once matter is known
  const cause = causationProgress(session)
  if (session.matterType === 'unknown') return Math.min(cause, 15)
  return cause
}

export function computeServiceConfidence(session: SessionState): number {
  let score = 0
  if (session.matterType !== 'unknown') score += 0.4
  if (session.jurisdiction !== 'Unknown' || session.locationHint) score += 0.35
  if (session.mode === 'browse' && session.matterType !== 'unknown') score += 0.2
  if (session.mode === 'info' && session.matterType !== 'unknown') score += 0.15
  if (session.goal) score += 0.1
  if (session.whatHappened || session.howCaused) score += 0.1
  if (session.mode === 'urgent') score += 0.15

  if (
    (session.mode === 'browse' || session.mode === 'info') &&
    session.matterType !== 'unknown' &&
    (session.locationHint || session.jurisdiction !== 'Unknown' || session.mode === 'info')
  ) {
    score = Math.max(score, 0.85)
  }

  return Math.min(1, Math.round(score * 100) / 100)
}

/** Used by brief readiness — true when no high-priority causation gaps remain. */
export function missingSlots(session: SessionState) {
  return openCausationGaps(session).map((g) => ({ id: g.id, label: g.label, filled: false, weight: g.priority }))
}

export function getSlots(session: SessionState) {
  return listCausationGaps(session).map((g) => ({
    id: g.id,
    label: g.label,
    filled: g.filled,
    weight: Math.max(1, Math.round(g.priority / 20)),
  }))
}
