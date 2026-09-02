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

const PARKING_SPECIALIST_RE =
  /popla|independent appeals|\bias\b|traffic penalty tribunal|london tribunals|parking (?:charge|appeal|adjudicator)/i

/** National seed helplines to pin near the top when matter + story align. */
const MATTER_SPECIALIST_IDS: Partial<Record<MatterType, readonly string[]>> = {
  housing: ['fs-shelter', 'fs-cab-adviceline-england', 'fs-cla'],
  employment: ['fs-acas', 'fs-cab-adviceline-england'],
  debt: ['fs-stepchange', 'fs-national-debtline', 'fs-cab-adviceline-england'],
  immigration: ['fs-cab-adviceline-england'],
  family: ['fs-cab-adviceline-england', 'fs-cla'],
  consumer: ['fs-cab-adviceline-england', 'fs-cab-consumer-helpline'],
}

const HOUSING_STORY_RE =
  /\b(tenant|tenancy|landlord|rental|rent\b|deposit|eviction|homeless|disrepair|letting|inventory|assignment|wear and tear|section\s*21|assured shorthold)\b/i

const LOCAL_ONLY_SERVICE_RE =
  /\b(based in (?:east )?london|in london only|camden|tower hamlets|mary ward|toynbee hall|south west london law)\b/i

/** Family / DA / contact orgs — wrong for pure belongings / small-claims disputes. */
const FAMILY_SUPPORT_ONLY_RE =
  /domestic (?:abuse|violence)|rape crisis|refuge\b|\bncdv\b|national centre for domestic|domestic violence assist|rights of women|ourfamilywizard|family mediation|\bresolution\b|dad'?s house|only dads|family rights group|child contact centre|womens aid|women'?s aid/i

const OFFTOPIC_FOR_PROPERTY_DAMAGE_RE =
  /age uk|creditor|universal credit|immigration|asylum|employment tribunal|ofcom|ofgem|mind\b|samaritans|debtline|stepchange/i

/** Damaged belongings / sue for replacement — often family-framed but free help is small-claims/CAB. */
export function isPropertyDamageClaimText(text: string): boolean {
  const t = (text || '').toLowerCase()
  if (isParkingStoryText(t)) return false
  const damage =
    /\b(threw|broke|broken|damaged|destroyed|smashed|ruined)\b/.test(t) ||
    /\b(sue|get (?:it|them) (?:back|fixed)|can'?t afford a new|replacement|small claims?|money claim|letter before action)\b/.test(
      t,
    )
  if (!damage) return false
  // Prefer property-recovery framing over pure divorce/DA free packs
  return true
}

/** Family context without strong divorce / custody / DA language. */
export function isFamilyBelongingsDisputeText(text: string): boolean {
  const t = (text || '').toLowerCase()
  if (!isPropertyDamageClaimText(t)) return false
  if (/\b(domestic abuse|non-molestation|care order|child arrangement|custody|divorce)\b/.test(t)) {
    return false
  }
  return /\b(ex|mum|mom|mother|dad|father|boyfriend|son|daughter|kid|child|children|year old)\b/.test(t)
}

export function isParkingSpecialistService(titleOrHay: string): boolean {
  return PARKING_SPECIALIST_RE.test(titleOrHay)
}

export function isHousingStoryText(text: string): boolean {
  return HOUSING_STORY_RE.test(text || '')
}

function isWeakExaDuplicate(svc: FreeServiceRecord): boolean {
  if (!(svc.source || '').includes('exa')) return false
  const blob = `${svc.title} ${svc.description}`
  if (/does not provide a housing advice helpline|no general shelter housing advice phone/i.test(blob)) {
    return true
  }
  if (/contact us.*shelter/i.test(svc.title) && svc.id !== 'fs-shelter') return true
  return false
}

function isLocalOnlyWithoutHint(svc: FreeServiceRecord, locationHint: string): boolean {
  if (locationHint.trim()) return false
  return LOCAL_ONLY_SERVICE_RE.test(serviceHay(svc))
}

function specialistBoost(svc: FreeServiceRecord, matter: MatterType, text: string): number {
  if (!(svc.source || '').startsWith('seed')) return 0
  let boost = 0
  const specialists = MATTER_SPECIALIST_IDS[matter] || []
  const rank = specialists.indexOf(svc.id)
  if (rank >= 0) boost += 18 - rank * 4

  if (matter === 'housing' && svc.id === 'fs-shelter') {
    boost += 10
    if (/\b(deposit|inventory|assignment|wear and tear)\b/i.test(text)) boost += 8
  }
  if (matter === 'employment' && svc.id === 'fs-acas') boost += 8
  if (matter === 'debt' && /stepchange|national debtline/i.test(svc.title)) boost += 6
  return boost
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
    if (session.matterType === 'housing' || HOUSING_STORY_RE.test(text)) {
      keys.add('area-housing-landlord-tenant')
    }
    if (/flight|holiday|airline|atol/.test(text)) keys.add('area-travel-flights-holidays')
    if (/energy|broadband|ofgem|ofcom/.test(text)) keys.add('area-energy-broadband-complaints')
    if (/neighbour|boundary|fence|tree/.test(text)) keys.add('area-neighbour-boundary-trees')
    // Family + damaged belongings / sue → also surface consumer / small-claims free help
    if (isPropertyDamageClaimText(text) || isFamilyBelongingsDisputeText(text)) {
      keys.add('area-consumer-goods-traders')
    }
  }

  return [...keys]
}

function entityLabel(entityType: string): string {
  return ENTITY_LABEL[entityType] || 'Free service'
}

function serviceHay(svc: FreeServiceRecord): string {
  return `${svc.title} ${svc.description} ${svc.keywords.join(' ')}`.toLowerCase()
}

function scoreService(
  svc: FreeServiceRecord,
  text: string,
  topicKeys: string[],
  matter: MatterType,
  locationHint: string,
  parking: boolean,
): number {
  let score = 0
  const hay = serviceHay(svc)
  const propertyDamage = isPropertyDamageClaimText(text)
  const familyBelongings = isFamilyBelongingsDisputeText(text)

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
  score += specialistBoost(svc, matter, text)

  if (isWeakExaDuplicate(svc)) score -= 60
  if (isLocalOnlyWithoutHint(svc, locationHint)) score -= 18
  if (
    matter === 'housing' &&
    (svc.source || '') === 'signpost-import' &&
    !locationHint &&
    svc.id !== 'fs-shelter'
  ) {
    score -= 6
  }

  // Parking specialists only when the story is parking — never bleed into other matters.
  if (parking && isParkingSpecialistService(svc.title)) {
    score += 10
  }
  const privateLand = /\b(private (?:land|parking|car\s*park)|popla|parking charge|operator)\b/i.test(text)
  if (parking && privateLand) {
    if (/popla|independent appeals|\bias\b/i.test(svc.title)) score += 8
    if (/traffic penalty tribunal|london tribunals/i.test(svc.title)) score -= 12
  }

  if (propertyDamage || familyBelongings) {
    if (/citizens advice|consumer helpline|advicenow|small claims|money claim|civil legal advice|legal aid agency/i.test(hay)) {
      score += 14
    }
    if (FAMILY_SUPPORT_ONLY_RE.test(hay) && !/\b(domestic (?:abuse|violence)|rape|refuge|molestation|harass)\b/i.test(text)) {
      score -= 40
    }
    if (OFFTOPIC_FOR_PROPERTY_DAMAGE_RE.test(hay)) score -= 25
    if (isParkingSpecialistService(svc.title)) score -= 30
  }

  // Unknown / unclassified: prefer seed CAB over niche Exa fills
  if (matter === 'unknown' || matter === 'other') {
    if ((svc.source || '').startsWith('seed') && /citizens advice|civil legal advice|legal aid/i.test(hay)) {
      score += 8
    }
    if (
      svc.topicKeys.includes('area-common-unclassified') &&
      !/citizens advice|legal aid|civil legal advice|advicenow/i.test(hay)
    ) {
      score -= 6
    }
  }

  return score
}

function parkingRelevant(s: FreeServiceRecord): boolean {
  const hay = serviceHay(s)
  if (/universal credit|stalking|domestic abuse|immigration|asylum|whistle/.test(hay)) return false
  if (/stepchange|debtline|bailiff|creditor harassment/.test(hay)) return false
  if (/age uk|free representation unit|\bfru\b|employment tribunal|social security|\bavma\b|clinical|medical accident/.test(hay))
    return false
  if (/citizens advice/.test(hay) && /adviceline|consumer helpline|parking|advice line/.test(hay)) {
    return true
  }
  return /parking|pcn|popla|\bias\b|independent appeals|tribunal|adjudicator|resolver/.test(hay)
}

function allowNonParkingHit(
  s: FreeServiceRecord,
  score: number,
  topicKeys: string[],
  matter: MatterType,
  text: string,
): boolean {
  if (isParkingSpecialistService(s.title) || isParkingSpecialistService(serviceHay(s))) {
    return false
  }

  const topicHit = s.topicKeys.some((tk) => topicKeys.includes(tk))
  const matterHit = s.matterTypes.includes(matter)
  const hay = serviceHay(s)
  const propertyDamage = isPropertyDamageClaimText(text)
  const familyBelongings = isFamilyBelongingsDisputeText(text)

  if (FAMILY_SUPPORT_ONLY_RE.test(hay) && (propertyDamage || familyBelongings)) {
    if (!/\b(domestic (?:abuse|violence)|rape|refuge|molestation)\b/i.test(text)) return false
  }
  if (OFFTOPIC_FOR_PROPERTY_DAMAGE_RE.test(hay) && (propertyDamage || familyBelongings)) {
    return false
  }

  // For belongings / small-claims path: require consumer topic or seed CAB — not family matter alone
  if (propertyDamage || familyBelongings) {
    const consumerTopic = s.topicKeys.includes('area-consumer-goods-traders')
    const seedAdvice =
      (s.source || '').startsWith('seed') &&
      /citizens advice|civil legal advice|legal aid/i.test(hay)
    if (seedAdvice || (consumerTopic && score >= 10)) return true
    if (topicHit && /citizens advice|consumer|small claim|advicenow|legal aid/i.test(hay) && score >= 10) {
      return true
    }
    return false
  }

  // Core seed advice always eligible when on-topic
  if ((s.source || '').startsWith('seed') && /citizens advice|civil legal advice|legal aid/i.test(hay)) {
    if (topicHit || matterHit) return true
  }

  if (topicHit && score >= 8) return true
  if (matterHit && score >= 12) return true
  // Keyword-only bar is high — stops weak Exa fills
  if (score >= 18) return true
  return false
}

function recordToHit(s: FreeServiceRecord, score: number): FreeServiceHit {
  return {
    id: s.id,
    title: s.title,
    type: entityLabel(s.entityType),
    blurb: s.description,
    phone: (s.phone || '').trim() || undefined,
    url: s.website || undefined,
    score,
    topicKeys: s.topicKeys,
  }
}

function pinMatterSpecialists(
  ranked: FreeServiceHit[],
  matter: MatterType,
  text: string,
  services: FreeServiceRecord[],
  limit: number,
): FreeServiceHit[] {
  const effectiveMatter: MatterType | null =
    matter === 'housing' || (isHousingStoryText(text) && (matter === 'unknown' || matter === 'other'))
      ? 'housing'
      : matter
  const specialistIds = effectiveMatter ? MATTER_SPECIALIST_IDS[effectiveMatter] : undefined
  if (!specialistIds?.length) return ranked

  const byId = new Map(services.map((s) => [s.id, s]))
  const pinned: FreeServiceHit[] = []
  const seen = new Set<string>()

  for (const id of specialistIds) {
    const svc = byId.get(id)
    if (!svc || isWeakExaDuplicate(svc)) continue
    if (!(svc.phone || '').trim() && !(svc.website || '').trim()) continue
    pinned.push(recordToHit(svc, 100 - pinned.length))
    seen.add(svc.id)
    if (pinned.length >= Math.min(3, limit)) break
  }

  const rest = ranked.filter((hit) => !seen.has(hit.id))
  return [...pinned, ...rest].slice(0, limit)
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
      if (isWeakExaDuplicate(s)) return false
      const hasPhone = (s.phone || '').trim().length > 0
      const hasWeb = (s.website || '').trim().length > 0
      // Parking appeal routes may be online-only; other areas still prefer dialable.
      if (parking) return hasPhone || hasWeb
      return hasPhone
    })
    .map((s) => ({
      s,
      score: scoreService(s, text, topicKeys, matter, locationHint, parking),
    }))
    .filter(({ score, s }) => {
      if (parking) return parkingRelevant(s)
      return allowNonParkingHit(s, score, topicKeys, matter, text)
    })

  scored.sort((a, b) => b.score - a.score)

  const seen = new Set<string>()
  const out: FreeServiceHit[] = []
  for (const { s, score } of scored) {
    if (score < 0) continue
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

  return pinMatterSpecialists(out, matter, text, bundle.services, limit)
}
