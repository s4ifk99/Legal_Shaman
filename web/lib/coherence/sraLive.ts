/**
 * Live SRA organisation search via /api/coherence/sra/search.
 */
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import { sraOrganisationAdmissible } from '@/lib/matter/graphAdmissibility'
import {
  buildSraSearchPayload,
  employerPropertySraFlags,
  hasPracticeRoute,
  matchingHelpLanesForStory,
  relevantWorkAreas,
  sraMatchReason,
  type SraSearchPayload,
} from './sraQuery'

export interface SraFirmHit {
  id: string
  title: string
  type: string
  blurb: string
  url?: string
  phone?: string
  postcode?: string
  city?: string
  sraId?: string
  score: number
}

export type SraEmptyReason = 'unavailable' | 'no_matches' | 'no_practice_route' | 'http_error'

export interface SraSearchMeta {
  configured: boolean
  reachable: boolean
  total?: number
  error?: string
  hitsReturned?: number
  emptyReason?: SraEmptyReason
}

type ApiHit = {
  sraId: string
  name: string
  city: string
  postcode: string
  phone: string
  website: string
  profileUrl: string
  workArea: string
  score: number
}

type LaneResult = {
  hits: SraFirmHit[]
  error?: string
  emptyReason?: SraEmptyReason
}

export async function sraStatus(): Promise<SraSearchMeta> {
  try {
    const res = await fetch('/api/coherence/sra/status')
    if (!res.ok) return { configured: false, reachable: false, error: `HTTP ${res.status}` }
    return (await res.json()) as SraSearchMeta
  } catch (err) {
    return {
      configured: false,
      reachable: false,
      error: err instanceof Error ? err.message : 'offline',
    }
  }
}

function mapHits(payload: SraSearchPayload, data: ApiHit[]): SraFirmHit[] {
  return data
    .filter((h) => sraOrganisationAdmissible(h.name))
    .map((h) => {
      const place = [h.city, h.postcode].filter(Boolean).join(' · ')
      const areas = relevantWorkAreas(
        h.workArea || '',
        payload.matterType,
        payload.wantCar,
        payload.taxonomySlug,
      )
      const reason = sraMatchReason(h.workArea || '', payload)
      return {
        id: `sra:${payload.matterType}:${h.sraId}`,
        title: h.name,
        type: 'SRA-regulated firm',
        blurb: [reason, place, areas.length ? `Work areas: ${areas.join(', ')}` : '', h.sraId ? `SRA ${h.sraId}` : '']
          .filter(Boolean)
          .join(' — '),
        url:
          h.profileUrl ||
          `https://www.sra.org.uk/consumers/register/search/?searchText=${encodeURIComponent(h.sraId || h.name)}`,
        phone: h.phone || undefined,
        postcode: h.postcode,
        city: h.city,
        sraId: h.sraId,
        score: h.score,
      }
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.phone ? 1 : 0) - (a.phone ? 1 : 0) ||
        a.title.localeCompare(b.title),
    )
}

async function fetchSraLane(payload: SraSearchPayload): Promise<LaneResult> {
  if (!hasPracticeRoute(payload) && !(payload.locationHint || '').trim()) {
    return { hits: [], emptyReason: 'no_practice_route', error: 'no_practice_route' }
  }
  try {
    const res = await fetch('/api/coherence/sra/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      return { hits: [], emptyReason: 'http_error', error: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as {
      hits?: ApiHit[]
      error?: string
      emptyReason?: SraEmptyReason
    }
    if (data.error === 'sra_directory_unavailable') {
      return { hits: [], emptyReason: 'unavailable', error: data.error }
    }
    if (data.error === 'no_practice_route' || data.emptyReason === 'no_practice_route') {
      return { hits: [], emptyReason: 'no_practice_route', error: data.error }
    }
    const hits = mapHits(payload, data.hits || [])
    return {
      hits,
      emptyReason: hits.length ? undefined : data.emptyReason || 'no_matches',
      error: data.error,
    }
  } catch (err) {
    return {
      hits: [],
      emptyReason: 'unavailable',
      error: err instanceof Error ? err.message : 'offline',
    }
  }
}

export type MatchSraResult = {
  firms: SraFirmHit[]
  search: Pick<SraSearchMeta, 'hitsReturned' | 'emptyReason' | 'error'>
}

/** Query live SRA register; return firms plus why the lane may be empty. */
export async function matchSraFirms(
  session: SessionState,
  limit = 5,
  frames: LegalFrame[] = [],
): Promise<MatchSraResult> {
  const defence = buildSraSearchPayload(session, frames, limit)
  const story = defence.query || ''
  if (!matchingHelpLanesForStory(story).includes('employer_property')) {
    const lane = await fetchSraLane(defence)
    return {
      firms: lane.hits,
      search: {
        hitsReturned: lane.hits.length,
        emptyReason: lane.emptyReason,
        error: lane.error,
      },
    }
  }
  const perLane = Math.max(3, Math.ceil(limit / 2))
  const employer: SraSearchPayload = {
    ...defence,
    ...employerPropertySraFlags(story),
    locationHint: defence.locationHint,
    query: story,
    limit: perLane,
  }
  const [defenceLane, employerLane] = await Promise.all([
    fetchSraLane({ ...defence, limit: perLane }),
    fetchSraLane(employer),
  ])
  const seen = new Set<string>()
  const out: SraFirmHit[] = []
  for (const hit of [...defenceLane.hits, ...employerLane.hits]) {
    const key = hit.sraId || hit.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
    if (out.length >= limit + 3) break
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      (b.phone ? 1 : 0) - (a.phone ? 1 : 0) ||
      a.title.localeCompare(b.title),
  )
  const emptyReason =
    out.length > 0
      ? undefined
      : defenceLane.emptyReason || employerLane.emptyReason || 'no_matches'
  return {
    firms: out.slice(0, limit + 3),
    search: {
      hitsReturned: out.length,
      emptyReason,
      error: defenceLane.error || employerLane.error,
    },
  }
}
