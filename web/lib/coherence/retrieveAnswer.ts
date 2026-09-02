import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import type { AnswerPackage } from './answerPackage'
import type { ResearchBundle } from './researchBundle'
import { MAX_SEARCH_QUERY_CHARS } from '@/lib/legal-search/query-limits'

export type RetrieveAnswerResult = {
  answerPackage: AnswerPackage | null
  retrieve?: { snippets?: unknown[]; layers?: string[] }
  origin?: string
  error?: string
}

export type AnswerFollowUpContext = {
  kind: 'clarify' | 'add_detail' | 'refine'
  text: string
  priorAnswer?: string
}

/** Build story text for Retrieve → Answer. */
export function sessionAnswerQuery(session: SessionState, frames: LegalFrame[] = []): string {
  const parts = [
    session.clientQuestion,
    session.briefUnderstanding,
    session.whatHappened,
    ...session.rawInputs.slice(-2),
  ]
    .map((p) => String(p || '').trim())
    .filter(Boolean)

  const frameLabels = frames
    .slice(0, 3)
    .map((f) => f.label)
    .filter(Boolean)
    .join(' ')
  if (frameLabels) parts.push(frameLabels)
  const story = String(session.whatHappened || '').toLowerCase()
  const goal = String(session.goal || '').trim()
  const caused = String(session.howCaused || '').trim()
  if (goal && goal.length >= 8 && !story.includes(goal.toLowerCase().slice(0, 40))) {
    if (!/^because i don't know/i.test(goal)) parts.push(goal)
  }
  if (caused && !/^because i don't know/i.test(caused) && !story.includes(caused.toLowerCase().slice(0, 40))) {
    parts.push(caused)
  }

  const seen = new Set<string>()
  const unique: string[] = []
  for (const p of parts) {
    const key = p.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(p)
  }
  return unique.join('\n\n').slice(0, MAX_SEARCH_QUERY_CHARS)
}

export function isStrongAnswerPackage(pack: AnswerPackage | null | undefined): boolean {
  if (!pack) return false
  const overview = (pack.answerOverview || '').trim()
  if (overview.length < 80) return false
  const origin = (pack as { origin?: string }).origin
  if (pack.matchedTopicId === 'vault-synthesized') return true
  if (origin === 'retrieve-llm' || origin === 'retrieve-deterministic') return true
  if (pack.wikiPages?.length >= 2 && overview.length >= 80) return true
  if (pack.wikiPages?.length >= 2 && pack.bullets?.length >= 2) return true
  return Boolean(pack.matchedTopicId && pack.bullets.length >= 2 && overview.length >= 120)
}

/** True when the overview is a finished synthesis — not a transient pack fallback. */
export function isFinalOverviewPackage(pack: AnswerPackage | null | undefined): boolean {
  if (!isStrongAnswerPackage(pack)) return false
  const origin = String((pack as { origin?: string }).origin || '')
  if (origin === 'pack') return false
  return (
    origin === 'retrieve-llm' ||
    origin === 'vault-synthesized' ||
    origin === 'retrieve-deterministic'
  )
}

/** On-demand Retrieve → OpenRouter Answer (when master pack not stored yet). */
export async function fetchRetrieveAnswer(
  session: SessionState,
  frames: LegalFrame[] = [],
  followUp?: AnswerFollowUpContext,
  researchBundle?: ResearchBundle,
): Promise<RetrieveAnswerResult | null> {
  const latestText = sessionAnswerQuery(session, frames)
  if (latestText.length < 8) return null

  try {
    const res = await fetch('/api/coherence/llm/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latestText,
        understanding: session.briefUnderstanding,
        clientQuestion: session.clientQuestion,
        matterType: session.matterType,
        topicId: session.topicId,
        searchMode: session.searchMode,
        whatHappened: session.whatHappened,
        goal: session.goal,
        frameIds: frames.map((f) => f.id),
        followUp,
        researchBundle,
      }),
    })
    const data = (await res.json().catch(() => null)) as RetrieveAnswerResult | null
    if (!res.ok) {
      console.warn('[coherence] answer API failed', res.status, data?.error)
      return data?.answerPackage ? data : null
    }
    return data
  } catch (err) {
    console.warn('[coherence] answer fetch error', err)
    return null
  }
}
