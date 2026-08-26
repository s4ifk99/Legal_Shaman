/**
 * Topic lock — once intake resolves a high-confidence frame, Overview / packs
 * must not re-infer a conflicting remedy template from keyword bleed.
 */
import type { LegalFrame } from './frames'
import { looksNeighbourDispute } from './sense'
import { buildRetrievalText } from './retrievalText'
import type { SessionState } from './types'
import { isFamilyBelongingsPropertyClaim } from '@/lib/legal/query-signals'

/** Deterministic Answer / Overview pack ids (answerPackage.matchedTopicId). */
export type LockedPackId =
  | 'neighbour-access-dispute'
  | 'car-reject-failed-repair'
  | 'private-parking-charge'
  | 'family-belongings-claim'

export type TopicLock = {
  /** Session / classify topic id */
  topicId: string
  /** Prefer this Answer pack when set */
  packId: LockedPackId
  /** Pack ids that must never win while this lock is active */
  forbiddenPackIds: LockedPackId[]
  reason: string
  confidence: number
}

const NEIGHBOUR_FORBIDDEN: LockedPackId[] = [
  'car-reject-failed-repair',
  'private-parking-charge',
]

const CAR_FORBIDDEN: LockedPackId[] = ['neighbour-access-dispute', 'private-parking-charge']

const PARKING_FORBIDDEN: LockedPackId[] = ['car-reject-failed-repair', 'neighbour-access-dispute']

function storyBlob(session: SessionState, frames: LegalFrame[]): string {
  return `${buildRetrievalText(session)} ${frames.map((f) => f.id).join(' ')} ${session.topicId || ''}`
}

function isUsedCarPurchaseStory(text: string): boolean {
  if (looksNeighbourDispute(text)) return false
  return (
    /\b(used car|bought .{0,24}(?:car|vehicle)|faulty (?:car|vehicle)|dealer|mot\b|fault codes?|motor ombudsman)\b/i.test(
      text,
    ) && /\b(reject|refund|repair|faulty|broke|warranty|trader)\b/i.test(text)
  )
}

function isPrivateParkingStory(text: string): boolean {
  if (looksNeighbourDispute(text)) return false
  return /\b(parking (?:fine|ticket|charge|app|company)|car\s*park|pcn|popla|private parking)\b/i.test(
    text,
  )
}

/**
 * Resolve a topic lock from frames + story. Prefer explicit pack classification /
 * hous-neighbour / session.topicId over bag-of-words re-inference.
 */
export function resolveTopicLock(
  session: SessionState,
  frames: LegalFrame[] = [],
): TopicLock | null {
  const text = storyBlob(session, frames)
  const top = frames[0]
  const frameIds = new Set(frames.map((f) => f.id))
  const classified = session.packClassification
  const classConf = classified?.confidence ?? 0
  const classPack = classified?.packId

  // LLM / user pack wins over keyword driveway bleed when confident enough
  if (classified && classConf >= 0.55) {
    if (classPack === 'own-property-use' || classPack === 'general-info') {
      return null
    }
    if (classPack === 'neighbour-access-dispute') {
      return {
        topicId: 'housing-access',
        packId: 'neighbour-access-dispute',
        forbiddenPackIds: NEIGHBOUR_FORBIDDEN,
        reason: `pack:${classified.source}`,
        confidence: Math.max(0.85, classConf),
      }
    }
    if (classPack === 'car-reject-failed-repair') {
      return {
        topicId: 'consumer-car',
        packId: 'car-reject-failed-repair',
        forbiddenPackIds: CAR_FORBIDDEN,
        reason: `pack:${classified.source}`,
        confidence: Math.max(0.85, classConf),
      }
    }
    if (classPack === 'private-parking-charge') {
      return {
        topicId: 'consumer-parking',
        packId: 'private-parking-charge',
        forbiddenPackIds: PARKING_FORBIDDEN,
        reason: `pack:${classified.source}`,
        confidence: Math.max(0.85, classConf),
      }
    }
    if (classPack === 'family-belongings-claim') {
      return {
        topicId: 'family-belongings',
        packId: 'family-belongings-claim',
        forbiddenPackIds: ['car-reject-failed-repair', 'neighbour-access-dispute'],
        reason: `pack:${classified.source}`,
        confidence: Math.max(0.85, classConf),
      }
    }
  }

  // Explicit own-drive topic — never neighbour-lock from bare driveway
  if (session.topicId === 'own-property-use' || session.topicId === 'general-info') {
    return null
  }

  if (frameIds.has('hous-neighbour') || looksNeighbourDispute(text)) {
    return {
      topicId: 'housing-access',
      packId: 'neighbour-access-dispute',
      forbiddenPackIds: NEIGHBOUR_FORBIDDEN,
      reason: top?.id === 'hous-neighbour' ? 'frame:hous-neighbour' : 'detector:neighbour_access',
      confidence: top?.id === 'hous-neighbour' ? Math.max(0.85, (top.fitScore ?? top.score) / 100) : 0.82,
    }
  }

  if (session.topicId === 'housing-access' || session.topicId === 'neighbour-access-dispute') {
    return {
      topicId: 'housing-access',
      packId: 'neighbour-access-dispute',
      forbiddenPackIds: NEIGHBOUR_FORBIDDEN,
      reason: 'session.topicId',
      confidence: 0.9,
    }
  }

  if (isFamilyBelongingsPropertyClaim(text)) {
    return {
      topicId: 'family-belongings',
      packId: 'family-belongings-claim',
      forbiddenPackIds: ['car-reject-failed-repair', 'neighbour-access-dispute'],
      reason: 'detector:family_belongings',
      confidence: 0.88,
    }
  }

  if (isPrivateParkingStory(text) || frameIds.has('cons-parking')) {
    return {
      topicId: 'consumer-parking',
      packId: 'private-parking-charge',
      forbiddenPackIds: PARKING_FORBIDDEN,
      reason: frameIds.has('cons-parking') ? 'frame:cons-parking' : 'detector:private_parking',
      confidence: 0.86,
    }
  }

  if (isUsedCarPurchaseStory(text) || session.topicId === 'consumer-car') {
    return {
      topicId: 'consumer-car',
      packId: 'car-reject-failed-repair',
      forbiddenPackIds: CAR_FORBIDDEN,
      reason: session.topicId === 'consumer-car' ? 'session.topicId' : 'detector:used_car',
      confidence: 0.86,
    }
  }

  return null
}

export function packConflictsWithLock(
  lock: TopicLock | null,
  matchedTopicId: string | null | undefined,
): boolean {
  if (!lock || !matchedTopicId) return false
  return (lock.forbiddenPackIds as string[]).includes(matchedTopicId)
}

/** Prefer locked pack id when the heuristic pack drifted. */
export function preferredPackId(
  lock: TopicLock | null,
  matchedTopicId: string | null | undefined,
): string | null {
  if (!lock) return matchedTopicId ?? null
  if (!matchedTopicId || packConflictsWithLock(lock, matchedTopicId)) return lock.packId
  return matchedTopicId
}

/** Apply lock onto session.topicId when missing or conflicting. */
export function applyTopicLockToSession(
  session: SessionState,
  frames: LegalFrame[] = [],
): SessionState {
  const lock = resolveTopicLock(session, frames)
  if (!lock) return session
  if (session.topicId === lock.topicId) return session
  // Do not overwrite an explicit consumer-car lock with nothing; only set when empty or conflicting
  const conflicting =
    session.topicId === 'consumer-car' && lock.packId === 'neighbour-access-dispute'
  const empty = !session.topicId || session.topicId === 'general' || session.topicId === 'unset'
  if (empty || conflicting || lock.confidence >= 0.85) {
    return { ...session, topicId: lock.topicId }
  }
  return session
}
