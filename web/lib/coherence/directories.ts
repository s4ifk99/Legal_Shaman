import type { MatterType, SessionState } from './types'

export interface DirectoryEntry {
  id: string
  title: string
  type: string
  blurb: string
  url: string
  searchUrlTemplate?: string
  matterTypes: MatterType[]
}

export interface DirectoryHit {
  id: string
  title: string
  type: string
  blurb: string
  url: string
}

export interface ProbonoSource {
  id: string
  title: string
  description: string
  practiceAreas: string[]
  city: string
  postcode: string
  website: string
  phone: string
  eligibility: string
}

export interface ProbonoHit {
  id: string
  title: string
  type: string
  blurb: string
  url?: string
  phone?: string
  score: number
}

interface DirBundle {
  note: string
  entries: DirectoryEntry[]
}

interface ProBundle {
  meta: { count: number }
  sources: ProbonoSource[]
}

let dirCache: DirBundle | null = null
let proCache: ProBundle | null = null

async function loadDirs(): Promise<DirBundle> {
  if (dirCache) return dirCache
  const mod = await import('@/data/coherence/v1Directories.json')
  dirCache = mod.default as DirBundle
  return dirCache
}

async function loadProbono(): Promise<ProBundle> {
  if (proCache) return proCache
  const mod = await import('@/data/coherence/v1Probono.json')
  proCache = mod.default as ProBundle
  return proCache
}

function fillTemplate(tpl: string | undefined, session: SessionState, fallback: string): string {
  if (!tpl) return fallback
  const issueByMatter: Partial<Record<SessionState['matterType'], string>> = {
    consumer: 'consumer rights',
    personal_injury: 'personal injury',
    conveyancing: 'conveyancing',
    debt: 'debt',
    crime: 'criminal law',
  }
  const issue =
    session.taxonomySlug === 'parking_pcn'
      ? 'parking PCN motoring RTA'
      : issueByMatter[session.matterType] ||
        (session.matterType === 'unknown' || session.matterType === 'other'
          ? 'legal help'
          : session.matterType.replace(/_/g, ' '))
  const loc = session.locationHint || ''
  const q = loc || issue
  return tpl
    .replace('{q}', encodeURIComponent(q))
    .replace('{issue}', encodeURIComponent(issue))
    .replace('{location}', encodeURIComponent(loc))
}

/** Official SRA / Law Society / OISC / legal-aid / CAB directory cards. */
export async function matchDirectories(session: SessionState): Promise<DirectoryHit[]> {
  const bundle = await loadDirs()
  const matter = session.matterType
  return bundle.entries
    .filter(
      (e) =>
        e.matterTypes.includes(matter) ||
        (matter === 'unknown' && (e.id === 'sra-register' || e.id === 'citizens-advice')),
    )
    .map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      blurb: e.blurb,
      url: fillTemplate(e.searchUrlTemplate, session, e.url),
    }))
}

/** Curated pro bono / law centre entries from V1. */
export async function matchProbono(session: SessionState, limit = 3): Promise<ProbonoHit[]> {
  const bundle = await loadProbono()
  const matter = session.matterType
  const hint = (session.locationHint || '').toLowerCase()
  const matterLabel =
    matter === 'personal_injury'
      ? 'injury'
      : matter === 'unknown'
        ? ''
        : matter.replace(/_/g, ' ')

  const scored = bundle.sources.map((s) => {
    let score = 1
    const areas = s.practiceAreas.map((a) => a.toLowerCase()).join(' ')
    if (matterLabel && areas.includes(matterLabel)) score += 6
    if (session.taxonomySlug === 'parking_pcn') {
      if (/motoring|crime|road traffic|parking|consumer/i.test(areas)) score += 8
      if (/employment/i.test(areas) && !/motoring|crime|consumer/i.test(areas)) score -= 12
    }
    if (matter === 'immigration' && /immigration|asylum|refugee/.test(areas + s.description.toLowerCase()))
      score += 6
    if (hint && (s.city.toLowerCase().includes(hint) || hint.includes(s.city.toLowerCase())))
      score += 5
    if (hint && s.postcode && hint.toUpperCase().includes(s.postcode.split(' ')[0] || '')) score += 4
    return { s, score }
  })

  scored.sort((a, b) => b.score - a.score)
  // Require a real practice-area / location hit — avoid dumping unrelated clinics
  const floor = matter === 'unknown' || matter === 'other' ? 1 : 5
  return scored
    .filter((x) => x.score >= floor)
    .slice(0, limit)
    .map(({ s, score }) => ({
      id: `probono:${s.id}`,
      title: s.title,
      type: 'Pro bono / law centre',
      blurb: [s.description, s.eligibility].filter(Boolean).join(' — ').slice(0, 220),
      url: s.website || undefined,
      phone: s.phone || undefined,
      score,
    }))
}

export async function directoriesNote() {
  const bundle = await loadDirs()
  return bundle.note
}
