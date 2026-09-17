/**
 * Authority-gated interrogator for unknown matters (T5).
 * Default path: local seed + firm index + Exa-learned cache — NO live Exa.
 * Live Exa only via _Meta/scripts/exa_authority_fallback.py (indexes into authorityExaIndex.json).
 */

import type { MatterType, SessionState } from './types'
import seed from '@/data/coherence/authority/authoritySeed.json'
import firmIndex from '@/data/coherence/authority/authorityFirmIndex.json'
import exaIndex from '@/data/coherence/authority/authorityExaIndex.json'
import {
  authorityScore,
  authorityTierForUrl,
  isAllowedAuthorityUrl,
  lawFirmNameForUrl,
  type AuthorityTier,
} from './authorityAllowlist'
import { evaluateSeedPage } from './authorityMatch'
import { firmPagePassesTopicGate } from './authorityTopicGate'
import { prepareAuthorityRetrievalText } from './authorityQueryRewrite'

export type AuthorityHit = {
  id: string
  title: string
  url: string
  tier: AuthorityTier | 'unknown'
  score: number
  matchedKeywords: string[]
  /** Present when tier === 'firm' */
  firm?: string
  kind?: 'official' | 'law_firm'
}

export type InterrogatorChoice = { id: string; label: string; value: string }

export type InterrogatorQuestion = {
  id: string
  text: string
  options: InterrogatorChoice[]
}

export type AuthorityPackage = {
  hits: AuthorityHit[]
  auditOk: boolean
  auditIssues: string[]
  suggestedMatter: MatterType
  overview: string
  firmOnly: boolean
}

type SeedPage = {
  id: string
  title: string
  url: string
  domain: string
  tier: string
  topic?: string
  keywords: string[]
  requireAny?: string[]
  excludeIf?: string[]
  firm?: string
}

const PAGES = (seed as { pages: SeedPage[] }).pages
const FIRM_PAGES = (firmIndex as { pages: SeedPage[] }).pages
const EXA_PAGES = (exaIndex as { pages: SeedPage[] }).pages

const TOPIC_TO_MATTER: Record<string, MatterType> = {
  housing: 'housing',
  employment: 'employment',
  debt: 'debt',
  consumer: 'consumer',
  crime: 'crime',
  family: 'family',
  immigration: 'immigration',
  parking_traffic: 'other',
  other: 'other',
}

export function needsAuthorityInterrogator(session: SessionState): boolean {
  if (session.answeredPromptIds.includes('authority_gate')) return false
  if (session.authorityHits?.length) return false
  const lowTax = !session.ukTaxonomyConfidence || session.ukTaxonomyConfidence < 0.55
  return session.matterType === 'unknown' || lowTax
}

export function proposeAuthorityQuestions(session: SessionState): InterrogatorQuestion[] {
  const qs: InterrogatorQuestion[] = []
  if (session.matterType === 'unknown' || session.ukTaxonomyConfidence < 0.55) {
    qs.push({
      id: 'authority_topic',
      text: 'What is this mainly about?',
      options: [
        { id: 'housing', label: 'Housing / landlord / rent', value: 'housing' },
        { id: 'employment', label: 'Work / employer', value: 'employment' },
        { id: 'debt', label: 'Debt / money / mortgage', value: 'debt' },
        { id: 'consumer', label: 'Something I bought / a trader', value: 'consumer' },
        { id: 'crime', label: 'Police / crime', value: 'crime' },
        { id: 'family', label: 'Family / divorce / children', value: 'family' },
        { id: 'parking_traffic', label: 'Parking / traffic fine', value: 'parking_traffic' },
        { id: 'other', label: 'Something else', value: 'other' },
      ],
    })
  }
  if (session.jurisdiction === 'Unknown') {
    qs.push({
      id: 'authority_jurisdiction',
      text: 'Where are you?',
      options: [
        { id: 'ew', label: 'England or Wales', value: 'EnglandWales' },
        { id: 'sc', label: 'Scotland', value: 'Scotland' },
        { id: 'ni', label: 'Northern Ireland', value: 'NorthernIreland' },
      ],
    })
  }
  qs.push({
    id: 'authority_goal',
    text: 'What do you need most right now?',
    options: [
      { id: 'rights', label: 'Understand my rights / options', value: 'rights' },
      { id: 'process', label: 'What to do next (steps)', value: 'process' },
      { id: 'help', label: 'Find regulated help', value: 'help' },
    ],
  })
  return qs.slice(0, 3)
}

/** Lay narrative only — rewrite happens in retrieveAuthorityLocal. */
function layBlobFromSession(session: SessionState): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.goal,
    ...(session.authorityAnswers || []),
  ]
    .filter(Boolean)
    .join(' ')
}

function toHit(page: SeedPage, matchPts: number, matched: string[]): AuthorityHit {
  const tier = authorityTierForUrl(page.url)
  const firm = lawFirmNameForUrl(page.url) || page.firm
  return {
    id: page.id,
    title: page.title,
    url: page.url,
    tier,
    score: authorityScore(page.url, 0) + matchPts,
    matchedKeywords: matched,
    firm: firm || undefined,
    kind: tier === 'firm' ? 'law_firm' : 'official',
  }
}

/** Offline official seeds (GOV.UK / CA / ACAS / …). */
export function retrieveAuthorityOfficial(text: string, limit = 5): AuthorityHit[] {
  const t = (text || '').toLowerCase()
  const hits: AuthorityHit[] = []
  for (const page of PAGES) {
    if (!isAllowedAuthorityUrl(page.url)) continue
    const ev = evaluateSeedPage(t, page)
    if (!ev.ok) continue
    hits.push(toHit(page, ev.matchPts, ev.matched))
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Offline SRA firm blog index — commentary only.
 * Matter/topic gate (DRM papers): drop firm pages whose topic ≠ query matter.
 */
export function retrieveAuthorityFirms(
  text: string,
  limit = 4,
  queryMatter?: MatterType | null,
): AuthorityHit[] {
  const t = (text || '').toLowerCase()
  const gateMatter =
    queryMatter && queryMatter !== 'unknown' ? queryMatter : suggestMatterFromText(t)
  const hits: AuthorityHit[] = []
  for (const page of FIRM_PAGES) {
    if (!isAllowedAuthorityUrl(page.url)) continue
    if (!firmPagePassesTopicGate(page, gateMatter)) continue
    const ev = evaluateSeedPage(t, page)
    if (!ev.ok) continue
    // Firm pages: require ≥1 multi-word phrase + solid score (reduce SEO noise)
    if (!ev.matched.some((m) => m.includes(' ')) || ev.matchPts < 24) continue
    hits.push(toHit(page, ev.matchPts, ev.matched))
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Offline Exa-learned cache (written by exa_authority_fallback.py). */
export function retrieveAuthorityExaCache(text: string, limit = 4): AuthorityHit[] {
  const t = (text || '').toLowerCase()
  const hits: AuthorityHit[] = []
  for (const page of EXA_PAGES) {
    if (!isAllowedAuthorityUrl(page.url)) continue
    const ev = evaluateSeedPage(t, page)
    if (!ev.ok) continue
    hits.push(toHit(page, ev.matchPts, ev.matched))
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Official first, then Exa-learned cache, then firm commentary.
 * Applies GuRE-style offline cue rewrite + confirmed reformulation before match.
 * Product path — no live Exa network calls.
 */
export function retrieveAuthorityLocal(
  text: string,
  limit = 6,
  queryMatter?: MatterType | null,
  confirmedReformulation?: string | null,
): AuthorityHit[] {
  const prep = prepareAuthorityRetrievalText({
    original: text || '',
    confirmedReformulation,
  })
  const retrieval = prep.retrievalText
  const gateMatter =
    queryMatter && queryMatter !== 'unknown'
      ? queryMatter
      : suggestMatterFromText(retrieval.toLowerCase())
  const official = retrieveAuthorityOfficial(retrieval, Math.max(3, limit - 2))
  const learned = retrieveAuthorityExaCache(retrieval, 3)
  const firms = retrieveAuthorityFirms(retrieval, 3, gateMatter)
  const merged = [...official, ...learned, ...firms]
  const seen = new Set<string>()
  const out: AuthorityHit[] = []
  for (const h of merged.sort((a, b) => b.score - a.score)) {
    if (seen.has(h.url)) continue
    seen.add(h.url)
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

export function auditAuthorityHits(hits: AuthorityHit[]): {
  ok: boolean
  issues: string[]
  firmOnly: boolean
} {
  const issues: string[] = []
  if (!hits.length) {
    issues.push('no-authority-hits')
    return { ok: false, issues, firmOnly: false }
  }
  for (const h of hits) {
    if (!isAllowedAuthorityUrl(h.url)) issues.push(`blocked-url:${h.id}`)
    if (h.tier === 'blocked' || h.tier === 'unknown') issues.push(`bad-tier:${h.id}`)
  }
  const hasOfficial = hits.some(
    (h) => h.tier === 'primary' || h.tier === 'secondary' || h.tier === 'tertiary',
  )
  const firmOnly = !hasOfficial && hits.every((h) => h.tier === 'firm')
  if (firmOnly) {
    issues.push('firm-commentary-only')
  }
  // Firm-only is allowed (cite as commentary) — not a hard fail
  const hard = issues.filter((i) => !i.startsWith('firm-commentary'))
  return { ok: hard.length === 0, issues, firmOnly }
}

/** Specific patterns first; word boundaries avoid rent⊂currently. */
export function suggestMatterFromText(text: string, topicAnswer?: string): MatterType {
  if (topicAnswer && TOPIC_TO_MATTER[topicAnswer]) return TOPIC_TO_MATTER[topicAnswer]
  const t = text.toLowerCase()
  if (/\b(parking\s+fine|parking\s+ticket|pcn|box\s+junction|traffic\s+fine|police\s+controlled|police\s+waving|penalty\s+points)\b/.test(t))
    return 'other'
  if (/\b(facebook\s+group|group\s+renamed|university\s+disciplinary|student\s+complaint)\b/.test(t))
    return 'other'
  if (/\bjury\b/.test(t)) return 'other'
  if (/\b(gym|fitness\s+membership|airline|flight)\b/.test(t)) return 'consumer'
  if (/\b(yodel|parcel|courier|royal\s+mail)\b/.test(t)) return 'consumer'
  if (/\b(iva|individual\s+voluntary|bailiff|mortgage)\b/.test(t)) return 'debt'
  if (/\b(landlord|tenant|tenancy|deposit\s+protection|evict|section\s*21|leasehold)\b/.test(t))
    return 'housing'
  if (
    /\b(employer|sacked|dismissed|\bpip\b|unfair\s+dismissal|acas|harassment|bullying|stalking|stalker|cis\b|haven'?t\s+been\s+paid)\b/.test(
      t,
    )
  )
    return 'employment'
  if (/\b(police|nfa|no\s+further\s+action|confiscated|seized)\b/.test(t)) return 'crime'
  if (/\b(divorce|child\s+arrangements|custody|probate|inherit|abroad|grandparents?\s+rights|parental\s+responsibility|elective\s+home\s+education|school\s+attendance)\b/.test(t))
    return 'family'
  if (/\b(using\s+my\s+address|identity\s+theft|identity\s+fraud|personal\s+details)\b/.test(t))
    return 'other'
  if (/\b(disrepair|housing\s+health|infestation|bed.?bugs?)\b/.test(t)) return 'housing'
  if (/\b(county\s+court\s+claim|acknowledgement\s+of\s+service)\b/.test(t)) return 'consumer'
  if (/\b(faulty|refund|trader|warranty|consumer\s+rights|garage|dealer)\b/.test(t))
    return 'consumer'
  return 'other'
}

export function buildAuthorityPackage(session: SessionState): AuthorityPackage {
  const lay = layBlobFromSession(session)
  const topic = session.authorityAnswers?.find((a) => a.startsWith('topic:'))?.slice(6)
  const prep = prepareAuthorityRetrievalText({
    original: lay || session.confirmedSearchQuery || '',
    confirmedReformulation: session.confirmedSearchQuery,
  })
  const suggestedMatter =
    session.matterType !== 'unknown'
      ? session.matterType
      : suggestMatterFromText(prep.retrievalText.toLowerCase(), topic)
  const hits = retrieveAuthorityLocal(
    lay || session.confirmedSearchQuery || '',
    6,
    suggestedMatter,
    session.confirmedSearchQuery,
  )
  const audit = auditAuthorityHits(hits)
  const firmNames = [...new Set(hits.filter((h) => h.firm).map((h) => h.firm!))]
  let overview: string
  if (!hits.length) {
    overview =
      'No trusted guidance matched yet. Try one more detail, or download notes for a solicitor.'
  } else if (audit.firmOnly) {
    overview = `We matched commentary from ${firmNames.join(', ') || 'a UK law firm'} blog(s). This is firm explanation — not official GOV.UK guidance and not legal advice. Prefer Citizens Advice / GOV.UK when available.`
  } else if (firmNames.length) {
    overview = `We matched ${hits.filter((h) => h.kind !== 'law_firm').length} official page(s) plus commentary from ${firmNames.join(', ')}. Firm blogs are secondary explainers — not a substitute for primary sources.`
  } else {
    overview = `We matched ${hits.length} trusted UK guidance page(s). These are signposts — not legal advice.`
  }

  return {
    hits,
    auditOk: audit.ok,
    auditIssues: audit.issues,
    suggestedMatter,
    overview,
    firmOnly: audit.firmOnly,
  }
}

function packToSessionFields(pack: AuthorityPackage, session: SessionState): Partial<SessionState> {
  return {
    matterType: session.matterType === 'unknown' ? pack.suggestedMatter : session.matterType,
    authorityHits: pack.hits.map((h) => ({
      id: h.id,
      title: h.title,
      url: h.url,
      tier: h.tier,
      score: h.score,
      firm: h.firm,
      kind: h.kind,
    })),
    authorityAuditOk: pack.auditOk,
    softFlags: pack.firmOnly
      ? Array.from(new Set([...session.softFlags, 'authority_firm_commentary']))
      : pack.auditOk
        ? session.softFlags
        : Array.from(new Set([...session.softFlags, 'authority_audit_weak'])),
  }
}

/** Apply interrogator answers + local retrieve onto session (no Exa). */
export function applyAuthorityInterrogator(
  session: SessionState,
  answers: Record<string, string>,
): SessionState {
  const authorityAnswers = Object.entries(answers).map(([k, v]) =>
    k === 'authority_topic' ? `topic:${v}` : k === 'authority_goal' ? `goal:${v}` : `${k}:${v}`,
  )
  let next: SessionState = {
    ...session,
    authorityAnswers,
    answeredPromptIds: Array.from(new Set([...session.answeredPromptIds, 'authority_gate'])),
  }
  if (answers.authority_jurisdiction) {
    next = {
      ...next,
      jurisdiction: answers.authority_jurisdiction as SessionState['jurisdiction'],
    }
  }
  const pack = buildAuthorityPackage(next)
  return { ...next, ...packToSessionFields(pack, next) }
}

/** Auto-run local retrieve without UI when opener already matches seeds. */
export function tryAutoAuthorityResolve(session: SessionState): SessionState | null {
  if (!needsAuthorityInterrogator(session)) return null
  const pack = buildAuthorityPackage(session)
  if (pack.hits.length < 1) return null
  const top = pack.hits[0]
  const strongOfficial =
    top?.kind !== 'law_firm' && (top?.matchedKeywords.length || 0) >= 2
  const multi = pack.hits.length >= 2
  if (!strongOfficial && !multi && top?.kind === 'law_firm' && (top.matchedKeywords.length || 0) < 3) {
    return null
  }
  return {
    ...session,
    answeredPromptIds: Array.from(new Set([...session.answeredPromptIds, 'authority_gate'])),
    authorityAnswers: session.authorityAnswers?.length ? session.authorityAnswers : ['auto:seed'],
    ...packToSessionFields(pack, session),
  }
}
