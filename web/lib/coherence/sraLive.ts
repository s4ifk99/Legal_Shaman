/**
 * Live SRA organisation search via Vite middleware → Postgres.
 * Server keeps DATABASE_URL; browser only calls /api/sra/search.
 */
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import { sraOrganisationAdmissible } from '@/lib/matter/graphAdmissibility'
import {
  buildSraSearchPayload,
  employerPropertySraFlags,
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

export interface SraSearchMeta {
  configured: boolean
  reachable: boolean
  total?: number
  error?: string
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

async function fetchSraLane(payload: SraSearchPayload): Promise<SraFirmHit[]> {
  try {
    const res = await fetch('/api/coherence/sra/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { hits?: ApiHit[]; error?: string }
    if (!data.hits?.length) return []
    return data.hits.filter((h) => sraOrganisationAdmissible(h.name)).map((h) => {
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
  } catch {
    return []
  }
}

/** Query live SRA register (Postgres via /api/sra/search). */
export async function matchSraFirms(
  session: SessionState,
  limit = 5,
  frames: LegalFrame[] = [],
): Promise<SraFirmHit[]> {
  const defence = buildSraSearchPayload(session, frames, limit)
  const story = defence.query || ''
  if (!matchingHelpLanesForStory(story).includes('employer_property')) {
    return fetchSraLane(defence)
  }
  const perLane = Math.max(3, Math.ceil(limit / 2))
  const employer: SraSearchPayload = {
    ...defence,
    ...employerPropertySraFlags(story),
    locationHint: defence.locationHint,
    query: story,
    limit: perLane,
  }
  const [defenceHits, employerHits] = await Promise.all([
    fetchSraLane({ ...defence, limit: perLane }),
    fetchSraLane(employer),
  ])
  const seen = new Set<string>()
  const out: SraFirmHit[] = []
  for (const hit of [...defenceHits, ...employerHits]) {
    const key = hit.sraId || hit.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
    if (out.length >= limit + 3) break
  }
  return out
}
