/**
 * Matter/topic gate for firm commentary (Exa hunt 20260820 DRM papers).
 * Drop firm hits whose page topic ≠ query matter — cuts off-topic SEO noise.
 * Product path: offline only.
 */

import type { MatterType } from './types'

/** Soft aliases: housing ↔ conveyancing; family ↔ private-client wills/probate. */
const COMPAT: Record<string, ReadonlySet<string>> = {
  housing: new Set(['housing', 'conveyancing']),
  conveyancing: new Set(['housing', 'conveyancing']),
  family: new Set(['family']),
  employment: new Set(['employment']),
  debt: new Set(['debt', 'consumer']),
  consumer: new Set(['consumer', 'debt']),
  crime: new Set(['crime']),
  immigration: new Set(['immigration']),
  personal_injury: new Set(['personal_injury']),
  other: new Set(['other', 'consumer']), // parking / jury / oddball — thin consumer OK
  unknown: new Set(['other']),
}

const TOPIC_ALIASES: Array<{ re: RegExp; matter: MatterType }> = [
  { re: /\b(landlord|tenant|tenancy|leasehold|rent|evict|section\s*21|housing|property\s+dispute)\b/i, matter: 'housing' },
  { re: /\b(conveyanc|freehold|ground\s+rent|stamp\s+duty|sdlt|buying\s+a\s+(flat|house|home)|selling\s+a\s+(flat|house))\b/i, matter: 'conveyancing' },
  { re: /\b(employment|unfair\s+dismiss|redundan|settlement\s+agreement|employer|workplace|acas|\bpip\b)\b/i, matter: 'employment' },
  { re: /\b(divorce|child\s+arrangement|custody|parental|family\s+law|prenup|nuptial)\b/i, matter: 'family' },
  { re: /\b(probate|will\b|wills|inherit|lasting\s+power|lpa|trust\b|estate\s+planning)\b/i, matter: 'family' },
  { re: /\b(immigration|visa|ilr|asylum|deport|nationality)\b/i, matter: 'immigration' },
  { re: /\b(iva|debt|bailiff|bankrupt|insolvency|mortgage\s+arrears)\b/i, matter: 'debt' },
  { re: /\b(consumer\s+rights|faulty|refund|trader|warranty|airline|flight|parcel|gym|membership)\b/i, matter: 'consumer' },
  { re: /\b(crime|criminal|police|prosecution|caution|nfa)\b/i, matter: 'crime' },
  { re: /\b(personal\s+injury|accident\s+at\s+work|whiplash|negligen)\b/i, matter: 'personal_injury' },
  { re: /\b(parking|pcn|traffic\s+fine|jury)\b/i, matter: 'other' },
]

/** Map catalogue topic strings → MatterType. */
export function matterFromTopicLabel(topic: string | undefined | null): MatterType | null {
  if (!topic) return null
  const t = topic.toLowerCase().trim()
  if (!t || t === 'general' || t === 'insights' || t === 'news') return null
  if (/landlord|tenant|housing|neighbour/.test(t)) return 'housing'
  if (/conveyanc|residential\s*property|commercial\s*property|property(?!\s*protection)/.test(t))
    return 'conveyancing'
  if (/^property$/.test(t) || t === 'property') return 'housing'
  if (/employ/.test(t)) return 'employment'
  if (/family|divorce|child/.test(t)) return 'family'
  if (/will|probate|private\s*client|trust/.test(t)) return 'family'
  if (/immigra|visa/.test(t)) return 'immigration'
  if (/debt|money|tax|iva/.test(t)) return 'debt'
  if (/consumer|airline|refund|small\s*claims|litigation/.test(t)) return 'consumer'
  if (/crime|criminal|regulatory/.test(t)) return 'crime'
  if (/injur|accident|clinical/.test(t)) return 'personal_injury'
  if (/corporate|commercial|business|company|small\s*business/.test(t)) return 'other'
  return null
}

export function inferPageMatter(page: {
  topic?: string
  title?: string
  url?: string
  id?: string
}): MatterType | null {
  const fromLabel = matterFromTopicLabel(page.topic)
  if (fromLabel) return fromLabel
  const blob = `${page.title || ''} ${page.url || ''} ${page.id || ''}`
  for (const { re, matter } of TOPIC_ALIASES) {
    if (re.test(blob)) return matter
  }
  return null
}

export function mattersCompatible(
  queryMatter: MatterType | string | null | undefined,
  pageMatter: MatterType | null,
): boolean {
  const q = (queryMatter || 'unknown') as MatterType
  if (!pageMatter) {
    // Unlabelled firm SEO: only OK when we also don't know the query matter
    return q === 'unknown'
  }
  const allowed = COMPAT[q] || COMPAT.unknown
  return allowed.has(pageMatter)
}

/**
 * Firm commentary gate (DRM mitigation).
 * Callers should pass a *resolved* query matter (from taxonomy or text suggest).
 * Unlabelled firm pages are dropped — too noisy after SEO corpus expansion.
 */
export function firmPagePassesTopicGate(
  page: { topic?: string; title?: string; url?: string; id?: string },
  queryMatter: MatterType | string | null | undefined,
): boolean {
  const q = (queryMatter || 'unknown') as MatterType
  const pageMatter = inferPageMatter(page)
  if (!pageMatter) return false
  return mattersCompatible(q, pageMatter)
}
