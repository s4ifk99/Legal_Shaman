/**
 * Offline free-services index — dialable charities, helplines, trusts per indexed area.
 * Filled by seed + exa_free_services_fill.py; product never calls Exa live.
 */
import { isParkingStoryText } from './signposting'
import { buildRetrievalText } from './retrievalText'
import type { MatterType, SessionState } from './types'
import index from '@/data/coherence/freeServicesIndex.json'

export type FreeServiceRecord = {
  id: string
  entityType: string
  title: string
  description: string
  /** Optional — many parking appeal routes are online-only. */
  phone?: string
  website?: string
  topicKeys: string[]
  matterTypes: MatterType[]
  keywords: string[]
  source?: string
  indexedAt?: string
  city?: string
}

export type FreeServiceHit = {
  id: string
  title: string
  type: string
  blurb: string
  phone?: string
  url?: string
  score: number
  topicKeys: string[]
}

const ENTITY_LABEL: Record<string, string> = {
  advice_charity: 'Free advice · charity',
  law_centre: 'Law centre',
  ombudsman: 'Ombudsman / appeals',
  regulator: 'Regulator',
  government: 'Official helpline',
  trust: 'Trust / specialist',
}

/** Map session matter + story → Exa area-* topic keys used in freeServicesIndex. */
export function topicKeysForSession(session: SessionState): string[] {
  const text = buildRetrievalText(session)
  const parking = session.taxonomySlug === 'parking_pcn' || isParkingStoryText(text)
  const fromAuthority = session.authorityAnswers
    ?.filter((a) => a.startsWith('topic:'))
    .map((a) => `area-${a.slice(6).replace(/_/g, '-')}`)
    .filter(Boolean)

  const keys = new Set<string>(fromAuthority || [])

  const matterMap: Partial<Record<MatterType, string[]>> = {
    housing: ['area-housing-landlord-tenant', 'area-leasehold-service-charge'],
    employment: ['area-employment-workplace'],
    immigration: ['area-immigration-visas'],
    debt: ['area-debt-bailiffs-finance', 'area-benefits-council-tax'],
    crime: ['area-crime-police-harassment', 'area-criminal-procedure'],
    family: ['area-family-children-divorce'],
    consumer: ['area-consumer-goods-traders'],
    personal_injury: ['area-medical-clinical-nhs'],
    conveyancing: ['area-conveyancing-property-sale'],
    other: ['area-common-unclassified'],
    unknown: ['area-common-unclassified'],
  }

  if (parking) {
    keys.add('area-motoring-parking-rta')
  } else {
    for (const k of matterMap[session.matterType] || []) keys.add(k)
    if (/flight|holiday|airline|atol/.test(text)) keys.add('area-travel-flights-holidays')
    if (/energy|broadband|ofgem|ofcom/.test(text)) keys.add('area-energy-broadband-complaints')
    if (/neighbour|boundary|fence|tree/.test(text)) keys.add('area-neighbour-boundary-trees')
  }

  return [...keys]
}

function entityLabel(entityType: string): string {
  return ENTITY_LABEL[entityType] || 'Free service'
}

function scoreService(
  svc: FreeServiceRecord,
  text: string,
  topicKeys: string[],
  matter: MatterType,
  locationHint: string,
): number {
  let score = 0
  const hay = `${svc.title} ${svc.description} ${svc.keywords.join(' ')}`.toLowerCase()

  for (const tk of svc.topicKeys) {
    if (topicKeys.includes(tk)) score += 8
  }
  if (svc.matterTypes.includes(matter)) score += 6
  if (matter === 'unknown' && svc.matterTypes.includes('other')) score += 2

  const tokens = text.split(/[^a-z0-9+]+/).filter((t) => t.length > 3).slice(0, 35)
  for (const t of tokens) {
    if (hay.includes(t)) score += 2
  }
  for (const kw of svc.keywords) {
    if (text.includes(kw.toLowerCase())) score += 3
  }

  if (locationHint && svc.city && locationHint.toLowerCase().includes(svc.city.toLowerCase())) {
    score += 5
  }

  if (svc.source === 'seed' || (svc.source || '').startsWith('seed')) score += 1
  // Prefer specialist parking appeal routes over generic CAB when story is parking.
  if (/popla|independent appeals|\bias\b|traffic penalty tribunal|london tribunals/i.test(svc.title)) {
    score += 10
  }
  // Private-land stories: boost POPLA/IAS; demote council-only tribunals.
  const privateLand = /\b(private (?:land|parking|car\s*park)|popla|parking charge|operator)\b/i.test(text)
  if (privateLand) {
    if (/popla|independent appeals|\bias\b/i.test(svc.title)) score += 8
    if (/traffic penalty tribunal|london tribunals/i.test(svc.title)) score -= 12
  }

  return score
}

function parkingRelevant(s: FreeServiceRecord): boolean {
  const hay = `${s.title} ${s.description} ${s.keywords.join(' ')}`.toLowerCase()
  if (/universal credit|stalking|domestic abuse|immigration|asylum|whistle/.test(hay)) return false
  if (/stepchange|debtline|bailiff|creditor harassment/.test(hay)) return false
  if (/age uk|free representation unit|\bfru\b|employment tribunal|social security|\bavma\b|clinical|medical accident/.test(hay))
    return false
  if (/citizens advice/.test(hay) && /adviceline|consumer helpline|parking|advice line/.test(hay)) {
    return true
  }
  return /parking|pcn|popla|\bias\b|independent appeals|tribunal|adjudicator|resolver/.test(hay)
}

/** Free charities / helplines / appeal routes from offline index, ranked by area + matter. */
export function matchFreeServices(session: SessionState, limit = 10): FreeServiceHit[] {
  const bundle = index as { services: FreeServiceRecord[] }
  const text = buildRetrievalText(session)
  const topicKeys = topicKeysForSession(session)
  const matter = session.matterType
  const locationHint = (session.locationHint || '').trim()

  const parking = session.taxonomySlug === 'parking_pcn' || isParkingStoryText(text)

  const scored = bundle.services
    .filter((s) => {
      const hasPhone = (s.phone || '').trim().length > 0
      const hasWeb = (s.website || '').trim().length > 0
      // Parking appeal routes may be online-only; other areas still prefer dialable.
      if (parking) return hasPhone || hasWeb
      return hasPhone
    })
    .map((s) => ({
      s,
      score: scoreService(s, text, topicKeys, matter, locationHint),
    }))
    .filter(({ score, s }) => {
      if (parking) return parkingRelevant(s)
      const topicHit = s.topicKeys.some((tk) => topicKeys.includes(tk))
      const matterHit = s.matterTypes.includes(matter)
      const keywordHit = score >= 10
      return topicHit || matterHit || keywordHit
    })

  scored.sort((a, b) => b.score - a.score)

  const seen = new Set<string>()
  const out: FreeServiceHit[] = []
  for (const { s, score } of scored) {
    const phoneKey = (s.phone || '').replace(/\D/g, '')
    if (phoneKey) {
      if (seen.has(`phone:${phoneKey}`)) continue
      seen.add(`phone:${phoneKey}`)
    }
    const urlKey = (s.website || '').replace(/\/$/, '').toLowerCase()
    if (urlKey) {
      if (seen.has(`url:${urlKey}`)) continue
      seen.add(`url:${urlKey}`)
    }
    out.push({
      id: s.id,
      title: s.title,
      type: entityLabel(s.entityType),
      blurb: s.description,
      phone: (s.phone || '').trim() || undefined,
      url: s.website || undefined,
      score,
      topicKeys: s.topicKeys,
    })
    if (out.length >= limit) break
  }

  return out
}
