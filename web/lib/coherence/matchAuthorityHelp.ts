/**
 * Bridge authority offline index (seeds + Exa cache + firm commentary) → Matching help.
 * No live Exa — product reads JSON only.
 */
import {
  retrieveAuthorityLocal,
  suggestMatterFromText,
  type AuthorityHit,
} from './authorityInterrogator'
import { buildRetrievalText } from './retrievalText'
import { isParkingStoryText } from './signposting'
import type { SessionState } from './types'

export type AuthorityHelpHit = {
  id: string
  title: string
  blurb: string
  url: string
  tier: string
  kind: 'official' | 'law_firm'
  firm?: string
  score: number
}

function toHelpHit(h: AuthorityHit): AuthorityHelpHit {
  const isFirm = h.kind === 'law_firm' || h.tier === 'firm'
  return {
    id: h.id,
    title: h.title,
    url: h.url,
    tier: h.tier,
    kind: isFirm ? 'law_firm' : 'official',
    firm: h.firm,
    score: h.score,
    blurb: isFirm
      ? `${h.firm || 'Law firm'} — indexed commentary you can read before contacting a solicitor (signposting only).`
      : 'Matched official or trusted guidance for your issue — free to use.',
  }
}

function sessionHitToAuthorityHit(h: SessionState['authorityHits'][number]): AuthorityHit {
  return {
    id: h.id,
    title: h.title,
    url: h.url,
    tier: (h.tier as AuthorityHit['tier']) || 'unknown',
    score: h.score,
    matchedKeywords: [],
    firm: h.firm,
    kind: h.kind,
  }
}

function mergeAuthorityHits(
  sessionHits: SessionState['authorityHits'] | undefined,
  retrieved: AuthorityHit[],
  limit: number,
): AuthorityHit[] {
  const seen = new Set<string>()
  const out: AuthorityHit[] = []
  for (const h of [...(sessionHits || []).map(sessionHitToAuthorityHit), ...retrieved]) {
    const key = h.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
    if (out.length >= limit) break
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Official pages + firm commentary from offline authority index for Matching help. */
export function matchAuthorityHelp(
  session: SessionState,
  limit = 10,
): { official: AuthorityHelpHit[]; firms: AuthorityHelpHit[] } {
  const retrieval = buildRetrievalText(session)
  const parking =
    session.taxonomySlug === 'parking_pcn' ||
    isParkingStoryText(retrieval || session.whatHappened)
  const topic = session.authorityAnswers?.find((a) => a.startsWith('topic:'))?.slice(6)
  const matter = parking
    ? 'consumer'
    : session.matterType !== 'unknown'
      ? session.matterType
      : suggestMatterFromText(retrieval, topic)

  const query = parking
    ? `private parking PCN POPLA appeal ${session.locationHint || ''} ${retrieval}`.trim()
    : retrieval || session.confirmedSearchQuery || session.whatHappened

  const retrieved = retrieveAuthorityLocal(query, limit, matter, session.confirmedSearchQuery)

  const merged = mergeAuthorityHits(session.authorityHits, retrieved, limit * 2)

  const official: AuthorityHelpHit[] = []
  const firms: AuthorityHelpHit[] = []
  for (const h of merged) {
    if (parking) {
      const hay = `${h.title} ${h.url}`.toLowerCase()
      if (!/parking|pcn|popla|ticket|penalty charge|motoring/.test(hay)) continue
      if (/penalty points|endorsement|disqualif/.test(hay) && !/parking/.test(hay)) continue
    }
    const row = toHelpHit(h)
    if (row.kind === 'law_firm') firms.push(row)
    else official.push(row)
  }

  return {
    official: official.slice(0, 6),
    firms: firms.slice(0, parking ? 2 : 4),
  }
}
