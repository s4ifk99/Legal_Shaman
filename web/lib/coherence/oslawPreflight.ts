/**
 * Pre-display audit for OSLAW / Answer packs.
 * Fail closed on topic conflicts; drop dead free-help / bullet URLs when checkable.
 */
import type { AnswerPackage } from './answerPackage'
import { buildAnswerPackage, enrichAnswerPackageWithOslaw } from './answerPackage'
import type { OslawCourse } from './wiki'
import { isPrivateParkingStory, isUsedCarPurchaseStory } from './wikiOslaw'
import { buildRetrievalText } from './retrievalText'
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import { packConflictsWithLock, resolveTopicLock } from './topicLock'

export type PreflightIssue = {
  code: string
  message: string
  severity: 'block-pathway' | 'drop-url' | 'warn'
}

export type OslawPreflightResult = {
  ok: boolean
  issues: PreflightIssue[]
  /** Pathway suppressed when it conflicts with Answer pack / story */
  course: OslawCourse | null
  /** Answer pack with dead URLs removed from freeHelp / bullets / sources */
  pack: AnswerPackage
}

const USED_CAR_BLOB =
  /used.?car|buying.?a.?used.?car|problem-with-a-used-car|decision-trees\/problem-with-a-used-car|faulty.?goods|rejecting a faulty used car/i

const PARKING_BLOB = /parking|pcn|popla|car\s*park|parking-ticket|challenging.?a.?ticket/i

function storyText(session: SessionState, frames: LegalFrame[]): string {
  return `${buildRetrievalText(session)} ${frames.map((f) => f.id).join(' ')}`
}

function courseBlob(course: OslawCourse): string {
  return [
    course.pathwayId,
    course.title,
    course.summary,
    course.primaryUrl,
    ...course.featuredTools.map((t) => `${t.id} ${t.title} ${t.url}`),
    ...course.steps.map((s) => `${s.id} ${s.label} ${s.url || ''}`),
  ]
    .join(' ')
    .toLowerCase()
}

/** Topic conflict: Answer pack / story vs wiki pathway. */
export function detectPathwayConflicts(
  session: SessionState,
  frames: LegalFrame[],
  pack: AnswerPackage,
  course: OslawCourse | null,
): PreflightIssue[] {
  if (!course) return []
  const issues: PreflightIssue[] = []
  const story = storyText(session, frames)
  const blob = courseBlob(course)
  const parkingStory = isPrivateParkingStory(story) && !isUsedCarPurchaseStory(story)
  const parkingPack = pack.matchedTopicId === 'private-parking-charge'
  const usedCarPack = pack.matchedTopicId === 'car-reject-failed-repair'

  if ((parkingStory || parkingPack) && USED_CAR_BLOB.test(blob)) {
    issues.push({
      code: 'pathway-used-car-on-parking',
      message:
        'Wiki pathway / tools look like used-car CRA, but the story (or Answer pack) is private parking.',
      severity: 'block-pathway',
    })
  }

  if (usedCarPack && PARKING_BLOB.test(blob) && !USED_CAR_BLOB.test(blob) && !isUsedCarPurchaseStory(story)) {
    issues.push({
      code: 'pathway-parking-on-used-car',
      message: 'Wiki pathway looks like parking, but Answer pack is used-car remedies.',
      severity: 'block-pathway',
    })
  }

  if (parkingStory || parkingPack) {
    for (const tool of course.featuredTools) {
      if (USED_CAR_BLOB.test(`${tool.id} ${tool.title} ${tool.url}`)) {
        issues.push({
          code: 'featured-tool-used-car-on-parking',
          message: `Featured tool blocked: ${tool.title}`,
          severity: 'block-pathway',
        })
      }
    }
  }

  const lock = resolveTopicLock(session, frames)
  if (lock && packConflictsWithLock(lock, pack.matchedTopicId)) {
    issues.push({
      code: 'topic-lock-pack-conflict',
      message: `Answer pack “${pack.matchedTopicId}” conflicts with topic lock “${lock.packId}” (${lock.reason}).`,
      severity: 'block-pathway',
    })
  }

  if (lock?.packId === 'neighbour-access-dispute' && USED_CAR_BLOB.test(blob)) {
    issues.push({
      code: 'pathway-used-car-on-neighbour',
      message: 'Wiki pathway looks like used-car CRA, but the story is a neighbour / driveway dispute.',
      severity: 'block-pathway',
    })
  }

  return issues
}

async function checkUrlAlive(url: string, signal?: AbortSignal): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false
  try {
    const res = await fetch(`/api/url-check?url=${encodeURIComponent(url)}`, {
      signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return true // proxy missing — do not strip links offline
    const data = (await res.json()) as { ok?: boolean; status?: number }
    if (typeof data.ok === 'boolean') return data.ok
    const status = data.status ?? 0
    return status >= 200 && status < 400
  } catch {
    return true // network/proxy failure — keep URL (fail open on check infra)
  }
}

export async function filterDeadUrls(
  pack: AnswerPackage,
  signal?: AbortSignal,
): Promise<{ pack: AnswerPackage; issues: PreflightIssue[] }> {
  const issues: PreflightIssue[] = []
  const urls = [
    ...pack.freeHelp.map((h) => h.url),
    ...pack.bullets.map((b) => b.sourceUrl),
    ...pack.sources.map((s) => s.url),
  ].filter(Boolean)
  const unique = [...new Set(urls)]
  const alive = new Map<string, boolean>()
  await Promise.all(
    unique.map(async (url) => {
      alive.set(url, await checkUrlAlive(url, signal))
    }),
  )

  const next: AnswerPackage = {
    ...pack,
    freeHelp: pack.freeHelp.filter((h) => {
      if (alive.get(h.url) !== false) return true
      issues.push({
        code: 'dead-free-help-url',
        message: `Dropped dead free-help URL: ${h.title}`,
        severity: 'drop-url',
      })
      return false
    }),
    bullets: pack.bullets.filter((b) => {
      if (alive.get(b.sourceUrl) !== false) return true
      issues.push({
        code: 'dead-bullet-url',
        message: `Dropped bullet with dead URL: ${b.sourceTitle}`,
        severity: 'drop-url',
      })
      return false
    }),
    sources: pack.sources.filter((s) => {
      if (alive.get(s.url) !== false) return true
      issues.push({
        code: 'dead-source-url',
        message: `Dropped dead source: ${s.title}`,
        severity: 'drop-url',
      })
      return false
    }),
  }

  // Re-run citation check after drops
  const { checkAnswerCitations } = await import('./citationCheck')
  next.citation = checkAnswerCitations(next)
  return { pack: next, issues }
}

/**
 * Run preflight before showing OSLAW results to the end user.
 */
export async function runOslawPreflight(
  session: SessionState,
  frames: LegalFrame[],
  pack: AnswerPackage,
  course: OslawCourse | null,
  signal?: AbortSignal,
): Promise<OslawPreflightResult> {
  const lock = resolveTopicLock(session, frames)
  let workingPack = pack
  const lockIssues: PreflightIssue[] = []
  if (lock && packConflictsWithLock(lock, pack.matchedTopicId)) {
    workingPack = buildAnswerPackage(session, frames)
    lockIssues.push({
      code: 'topic-lock-override',
      message: `Replaced conflicting pack “${pack.matchedTopicId}” with locked “${lock.packId}”.`,
      severity: 'warn',
    })
  }

  const conflictIssues = detectPathwayConflicts(session, frames, workingPack, course)
  const blockPathway = conflictIssues.some((i) => i.severity === 'block-pathway')
  workingPack = enrichAnswerPackageWithOslaw(workingPack, blockPathway ? null : course, session)
  const { pack: filteredPack, issues: urlIssues } = await filterDeadUrls(workingPack, signal)
  const issues = [...lockIssues, ...conflictIssues, ...urlIssues]

  let safeCourse = blockPathway ? null : course
  const story = storyText(session, frames)
  if (safeCourse && isPrivateParkingStory(story) && !isUsedCarPurchaseStory(story)) {
    const tools = safeCourse.featuredTools.filter(
      (t) => !USED_CAR_BLOB.test(`${t.id} ${t.title} ${t.url}`),
    )
    const steps = safeCourse.steps.filter(
      (s) => !USED_CAR_BLOB.test(`${s.id} ${s.label} ${s.url || ''}`),
    )
    safeCourse = { ...safeCourse, featuredTools: tools, steps }
  }
  if (safeCourse && lock?.packId === 'neighbour-access-dispute') {
    const tools = safeCourse.featuredTools.filter(
      (t) => !USED_CAR_BLOB.test(`${t.id} ${t.title} ${t.url}`),
    )
    const steps = safeCourse.steps.filter(
      (s) => !USED_CAR_BLOB.test(`${s.id} ${s.label} ${s.url || ''}`),
    )
    safeCourse = { ...safeCourse, featuredTools: tools, steps }
  }

  return {
    ok: !issues.some((i) => i.severity === 'block-pathway') && filteredPack.citation.ok,
    issues,
    course: safeCourse,
    pack: filteredPack,
  }
}
