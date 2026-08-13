import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import { MAX_SEARCH_QUERY_CHARS } from '@/lib/legal-search/query-limits'

export type CoherenceWikiAnswer = {
  query: string
  mode: 'synthesis' | 'retrieval_only' | 'insufficient'
  answer: string | null
  wikiPages: {
    id: string
    title: string
    category: string
    summary: string
    score: number
  }[]
  sources: { name: string; detail?: string }[]
  recommendedFirms: {
    firm: string
    practiceArea: string
    articleCount: number
    directoryUrl: string
  }[]
  disclaimer: string
  retrievalScore: number
  message?: string
  meta?: { pageCount?: number; indexedAt?: string; wikiRoot?: string }
}

/** Build a retrieval query from the live intake story. */
export function sessionWikiQuery(session: SessionState, frames: LegalFrame[] = []): string {
  const parts = [
    session.clientQuestion,
    session.briefUnderstanding,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.rawInputs.slice(-2),
    ...session.events.slice(0, 6).map((e) => [e.label, e.rawSpan].filter(Boolean).join(' ')),
    frames
      .slice(0, 3)
      .map((f) => f.label)
      .join(' '),
  ]
    .map((p) => String(p || '').trim())
    .filter(Boolean)

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

export async function fetchLegalShamanAnswer(
  session: SessionState,
  frames: LegalFrame[] = [],
): Promise<CoherenceWikiAnswer | null> {
  const query = sessionWikiQuery(session, frames)
  if (query.length < 8) return null

  try {
    const res = await fetch('/api/coherence/wiki/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) return null
    return (await res.json()) as CoherenceWikiAnswer
  } catch {
    return null
  }
}

export function isStrongWikiAnswer(a: CoherenceWikiAnswer | null): boolean {
  if (!a) return false
  if (a.mode === 'insufficient') return false
  if (a.mode === 'synthesis' && (a.answer || '').trim().length >= 120) return true
  if (a.mode === 'retrieval_only' && a.wikiPages.length >= 2 && a.retrievalScore >= 8) return true
  return Boolean(a.answer && a.answer.trim().length >= 120)
}
