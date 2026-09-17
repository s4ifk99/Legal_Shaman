import { isPcnAppealQuery, isVehicleRepairQuery } from '@/lib/legal/query-signals'
import { resolveTaxonomy } from '@/lib/legal/taxonomy-resolver'
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import { storyLooksMotoringCrime, storyLooksEmployerSeizedKit } from '@/lib/matter/graphAdmissibility'

export type SraSearchPayload = {
  locationHint: string
  matterType: string
  query: string
  limit: number
  taxonomySlug?: string | null
  wantCar: boolean
  wantConsumer: boolean
  wantHousing: boolean
  wantEmployment: boolean
  wantImmigration: boolean
  wantMotoring: boolean
  /** Libel / slander / reputation / media demand letters */
  wantDefamation: boolean
  wantFamily: boolean
  wantDebt: boolean
  wantPersonalInjury: boolean
  /** General civil litigation catch-all when no narrower lane applies */
  wantLitigation: boolean
  /** Criminal defence (non-motoring or with motoring) */
  wantCrime: boolean
}

export type SraPracticeFlags = Omit<SraSearchPayload, 'locationHint' | 'limit' | 'matterType' | 'query' | 'taxonomySlug'>

const EMPLOYMENT_DISPUTE =
  /\b(unfair dismiss|sacked|fired|redundan|acas|grievance|unpaid wages|holiday pay|settlement agreement|employment tribunal|rights at work)\b/i

const DEFAMATION_STORY =
  /\b(defamation|libell?|slander|reputation|take.?down|cease and desist|letter before (?:action|claim)|media law|online (?:post|review|comment)|damages.{0,40}(?:online|post|article|publication))\b/i

const FAMILY_STORY =
  /\b(divorce|separation|child (?:arrangements?|contact|custody)|spouse|matrimonial|domestic abuse|family court|parental responsibility)\b/i

const DEBT_STORY =
  /\b(debt|bailiff|county court judgment|\bccj\b|insolvency|bankrupt|creditor|money claim|unpaid bill|enforcement)\b/i

const PI_STORY =
  /\b(personal injury|accident claim|whiplash|medical negligence|clinical negligence|slip and fall|rta claim|injury claim)\b/i

function off(): SraPracticeFlags {
  return {
    wantCar: false,
    wantConsumer: false,
    wantHousing: false,
    wantEmployment: false,
    wantImmigration: false,
    wantMotoring: false,
    wantDefamation: false,
    wantFamily: false,
    wantDebt: false,
    wantPersonalInjury: false,
    wantLitigation: false,
    wantCrime: false,
  }
}

/** True when at least one practice-area lane can hit the SRA register. */
export function hasPracticeRoute(
  flags: Pick<
    SraSearchPayload,
    | 'wantCar'
    | 'wantConsumer'
    | 'wantHousing'
    | 'wantEmployment'
    | 'wantImmigration'
    | 'wantMotoring'
    | 'wantDefamation'
    | 'wantFamily'
    | 'wantDebt'
    | 'wantPersonalInjury'
    | 'wantLitigation'
    | 'wantCrime'
  >,
): boolean {
  return Boolean(
    flags.wantCar ||
      flags.wantConsumer ||
      flags.wantHousing ||
      flags.wantEmployment ||
      flags.wantImmigration ||
      flags.wantMotoring ||
      flags.wantDefamation ||
      flags.wantFamily ||
      flags.wantDebt ||
      flags.wantPersonalInjury ||
      flags.wantLitigation ||
      flags.wantCrime,
  )
}

export function resolveSraSearchFlags(opts: {
  matterType?: string
  query?: string
  taxonomySlug?: string | null
  wantCar?: boolean
  wantConsumer?: boolean
  wantHousing?: boolean
  wantEmployment?: boolean
  wantImmigration?: boolean
  wantMotoring?: boolean
  wantDefamation?: boolean
  wantFamily?: boolean
  wantDebt?: boolean
  wantPersonalInjury?: boolean
  wantLitigation?: boolean
  wantCrime?: boolean
}): Omit<SraSearchPayload, 'locationHint' | 'limit'> {
  const query = String(opts.query || '')
  const taxonomySlug =
    opts.taxonomySlug || resolveTaxonomy({ story: query })?.taxonomySlug || null
  let matter = String(opts.matterType || 'unknown').toLowerCase()

  if (taxonomySlug === 'parking_pcn' || isPcnAppealQuery(query)) {
    return {
      matterType: 'consumer',
      query,
      taxonomySlug: taxonomySlug || 'parking_pcn',
      ...off(),
      wantConsumer: true,
    }
  }
  if (taxonomySlug === 'criminal_defence' || matter === 'crime') {
    const motoring = storyLooksMotoringCrime(query)
    return {
      matterType: 'crime',
      query,
      taxonomySlug: taxonomySlug || 'criminal_defence',
      ...off(),
      wantMotoring: motoring,
      wantCrime: true,
    }
  }
  if (taxonomySlug === 'consumer_vehicle_repair' || isVehicleRepairQuery(query)) {
    return {
      matterType: 'consumer',
      query,
      taxonomySlug: taxonomySlug || 'consumer_vehicle_repair',
      ...off(),
      wantCar: true,
      wantConsumer: true,
    }
  }
  if (taxonomySlug === 'housing' || taxonomySlug === 'neighbour_dispute') {
    return {
      matterType: 'housing',
      query,
      taxonomySlug,
      ...off(),
      wantHousing: true,
    }
  }
  if (taxonomySlug === 'conveyancing') {
    return {
      matterType: 'conveyancing',
      query,
      taxonomySlug,
      ...off(),
      wantHousing: true,
    }
  }
  if (taxonomySlug === 'employment') {
    return {
      matterType: 'employment',
      query,
      taxonomySlug,
      ...off(),
      wantEmployment: true,
    }
  }
  if (taxonomySlug === 'immigration') {
    return {
      matterType: 'immigration',
      query,
      taxonomySlug,
      ...off(),
      wantImmigration: true,
    }
  }
  if (taxonomySlug === 'defamation_media' || DEFAMATION_STORY.test(query)) {
    return {
      matterType: matter === 'unknown' || matter === 'other' ? 'other' : matter,
      query,
      taxonomySlug: taxonomySlug || 'defamation_media',
      ...off(),
      wantDefamation: true,
    }
  }
  if (taxonomySlug === 'family' || matter === 'family' || FAMILY_STORY.test(query)) {
    return {
      matterType: 'family',
      query,
      taxonomySlug: taxonomySlug || 'family',
      ...off(),
      wantFamily: true,
    }
  }
  if (taxonomySlug === 'debt' || matter === 'debt' || DEBT_STORY.test(query)) {
    return {
      matterType: 'debt',
      query,
      taxonomySlug: taxonomySlug || 'debt',
      ...off(),
      wantDebt: true,
    }
  }
  if (
    taxonomySlug === 'personal_injury' ||
    matter === 'personal_injury' ||
    PI_STORY.test(query)
  ) {
    return {
      matterType: 'personal_injury',
      query,
      taxonomySlug: taxonomySlug || 'personal_injury',
      ...off(),
      wantPersonalInjury: true,
    }
  }

  if (taxonomySlug === 'consumer' || taxonomySlug === 'consumer_services') {
    matter = 'consumer'
  }

  const wantImmigration =
    opts.wantImmigration ??
    (matter === 'immigration' ||
      /\bilr\b|visa|asylum|home office|deport|immigration|settlement/.test(query))
  const wantConsumer =
    opts.wantConsumer ??
    (matter === 'consumer' ||
      /\bconsumer\b|refund|faulty|warranty|trader|goods|guarantee/.test(query))
  const wantCar =
    opts.wantCar ??
    /\b(dealer|garage|mot\b|battery|fault codes?|used car|motor ombudsman)\b/.test(query)
  const wantHousing =
    opts.wantHousing ??
    (matter === 'housing' ||
      /landlord|tenant|evict|homeless|disrepair|mould|deposit/.test(query))
  const wantEmployment =
    opts.wantEmployment ??
    (matter === 'employment' || EMPLOYMENT_DISPUTE.test(query))
  const wantDefamation =
    opts.wantDefamation ?? (taxonomySlug === 'defamation_media' || DEFAMATION_STORY.test(query))
  const wantFamily =
    opts.wantFamily ?? (matter === 'family' || taxonomySlug === 'family' || FAMILY_STORY.test(query))
  const wantDebt =
    opts.wantDebt ?? (matter === 'debt' || taxonomySlug === 'debt' || DEBT_STORY.test(query))
  const wantPersonalInjury =
    opts.wantPersonalInjury ??
    (matter === 'personal_injury' || taxonomySlug === 'personal_injury' || PI_STORY.test(query))
  const wantCrime =
    opts.wantCrime ?? (matter === 'crime' || taxonomySlug === 'criminal_defence')
  const wantMotoring = Boolean(opts.wantMotoring)

  // Catch-all: classified-but-unmapped or long civil stories still hit Litigation firms.
  const wantLitigation =
    opts.wantLitigation ??
    (!(
      wantImmigration ||
      wantConsumer ||
      wantCar ||
      wantHousing ||
      wantEmployment ||
      wantDefamation ||
      wantFamily ||
      wantDebt ||
      wantPersonalInjury ||
      wantCrime ||
      wantMotoring
    ) &&
      (matter === 'other' ||
        matter === 'unknown' ||
        Boolean(taxonomySlug) ||
        query.trim().length >= 40))

  return {
    matterType: matter,
    query,
    taxonomySlug,
    wantCar: Boolean(wantCar),
    wantConsumer: Boolean(wantConsumer),
    wantHousing: Boolean(wantHousing),
    wantEmployment: Boolean(wantEmployment),
    wantImmigration: Boolean(wantImmigration),
    wantMotoring,
    wantDefamation: Boolean(wantDefamation),
    wantFamily: Boolean(wantFamily),
    wantDebt: Boolean(wantDebt),
    wantPersonalInjury: Boolean(wantPersonalInjury),
    wantLitigation: Boolean(wantLitigation),
    wantCrime: Boolean(wantCrime),
  }
}

function storyBlob(session: SessionState, frames: LegalFrame[] = []): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => `${e.label} ${e.rawSpan ?? ''}`),
    session.matterType,
    ...frames.map((f) => f.id),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Build a matter-aware SRA search payload from intake session + frames. */
export function buildSraSearchPayload(
  session: SessionState,
  frames: LegalFrame[] = [],
  limit = 5,
): SraSearchPayload {
  const text = storyBlob(session, frames)
  const flags = resolveSraSearchFlags({
    matterType: session.matterType,
    query: text,
    taxonomySlug: session.taxonomySlug,
    wantHousing:
      session.taxonomySlug === 'parking_pcn'
        ? false
        : session.matterType === 'housing' || frames.some((f) => f.id.startsWith('hous-'))
          ? true
          : undefined,
    wantEmployment:
      session.taxonomySlug === 'parking_pcn' || session.taxonomySlug === 'consumer_vehicle_repair'
        ? false
        : session.matterType === 'employment' || frames.some((f) => f.id.startsWith('emp-'))
          ? true
          : undefined,
    wantMotoring:
      session.taxonomySlug === 'parking_pcn'
        ? false
        : session.matterType === 'crime'
          ? storyLooksMotoringCrime(text)
          : undefined,
    wantImmigration:
      session.matterType === 'immigration' || frames.some((f) => f.id.startsWith('imm-'))
        ? true
        : undefined,
  })

  return {
    locationHint: session.locationHint || '',
    ...flags,
    query: text.slice(0, 500),
    limit,
  }
}

/** County / nation names → outward postcode areas for SRA geo ranking. */
const COUNTY_OUTWARD_CODES: Record<string, string[]> = {
  cornwall: ['TR', 'PL'],
  devon: ['EX', 'TQ', 'PL'],
  dorset: ['DT', 'BH'],
  somerset: ['TA', 'BA'],
  hampshire: ['SO', 'PO', 'GU'],
  kent: ['CT', 'ME', 'TN', 'DA'],
  surrey: ['GU', 'KT', 'RH', 'SM', 'TW'],
  essex: ['CM', 'CO', 'IG', 'RM', 'SS'],
  sussex: ['BN', 'RH', 'TN', 'PO'],
  'east sussex': ['BN', 'TN'],
  'west sussex': ['BN', 'PO', 'RH'],
  wiltshire: ['SN', 'SP', 'BA'],
  bristol: ['BS'],
  london: ['E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC'],
}

/** Outward postcode prefixes for a free-text place (county, town, or postcode area). */
export function postcodePrefixesForLocation(hint: string): string[] {
  const raw = (hint || '').trim()
  if (!raw) return []
  const lower = raw.toLowerCase()
  for (const [county, codes] of Object.entries(COUNTY_OUTWARD_CODES)) {
    if (lower === county || lower.includes(county)) return codes
  }
  const area = raw.toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/)?.[1]
  return area ? [area] : []
}

const RELEVANT_AREA_HINTS: Record<string, RegExp> = {
  consumer: /consumer|sale of goods|trader|commercial(?!.*corporate)/i,
  car: /consumer|motor|vehicle|litigation|dispute/i,
  parking: /consumer|litigation|dispute|parking|motoring|road traffic|\brta\b/i,
  housing: /housing|landlord|tenant|property.residential|disrepair/i,
  employment: /employment|workplace|tribunal|discriminat/i,
  immigration: /immigration|asylum|nationality/i,
  crime: /criminal|crime|police|magistrates|defence/i,
  defamation: /defamation|libel|slander|media|reputation|litigation/i,
  family: /family|children|matrimonial|divorce|domestic/i,
  debt: /debt|insolvency|bankrupt|money|enforcement/i,
  personal_injury: /personal injury|clinical|medical negligence|accident/i,
  litigation: /litigation|dispute|civil/i,
}

/** Score a register work-area blob the same way Matching Help ranks housing vs IP. */
export function scoreSraWorkAreaForMatching(
  workArea: string,
  flags: Pick<
    SraSearchPayload,
    | 'wantHousing'
    | 'wantEmployment'
    | 'wantImmigration'
    | 'wantConsumer'
    | 'wantCar'
    | 'wantMotoring'
    | 'wantDefamation'
    | 'wantFamily'
    | 'wantDebt'
    | 'wantPersonalInjury'
    | 'wantLitigation'
    | 'wantCrime'
    | 'matterType'
  >,
): number {
  const w = workArea || ''
  let score = 0
  if (flags.wantHousing && /Housing|Landlord|Tenant/i.test(w)) score += 28
  if (flags.wantHousing && /Property - Residential/i.test(w) && !/Intellectual Property/i.test(w)) {
    score += 10
  }
  if (flags.wantEmployment && /Employment/i.test(w)) score += 24
  if (flags.wantImmigration && /Immigration/i.test(w)) score += 24
  if (flags.wantConsumer && /Consumer/i.test(w)) score += 28
  if (flags.wantCar && /Litigation/i.test(w)) score += 8
  if (flags.wantDefamation && /Defamation|Libel|Slander/i.test(w)) score += 36
  if (flags.wantDefamation && /Media and Entertainment|Media\b/i.test(w)) score += 24
  if (flags.wantDefamation && /Litigation/i.test(w)) score += 12
  if (flags.wantFamily && /Family|Children|Matrimonial|Divorce/i.test(w)) score += 28
  if (flags.wantDebt && /Debt|Insolvency|Bankruptcy/i.test(w)) score += 28
  if (flags.wantPersonalInjury && /Personal Injury|Clinical Negligence|Medical Negligence/i.test(w)) {
    score += 28
  }
  if (flags.wantLitigation && /Litigation/i.test(w)) score += 22
  if (flags.wantCrime && /Criminal|Crime -/i.test(w) && !/Motoring|Road Traffic/i.test(w)) score += 32
  if (flags.wantMotoring && /Motoring|Road Traffic/i.test(w)) score += 32
  if (flags.matterType === 'crime' && !flags.wantMotoring) {
    if (/Motoring|Road Traffic|\bPCN\b|parking/i.test(w) && !/Criminal/i.test(w)) score -= 24
  }
  if (flags.wantMotoring && /Criminal|Crime -/i.test(w)) score += 24
  if (flags.wantHousing && /Intellectual Property/i.test(w)) score -= 40
  if (
    flags.wantHousing &&
    /Property - Commercial/i.test(w) &&
    !/Housing|Landlord|Tenant/i.test(w)
  ) {
    score -= 22
  }
  return score
}

/** Pick work areas to show on a firm card for this matter. */
export function relevantWorkAreas(
  workAreaRaw: string,
  matterType: string,
  wantCar: boolean,
  taxonomySlug?: string | null,
): string[] {
  const areas = workAreaRaw
    .replace(/[\[\]"]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const hint =
    taxonomySlug === 'parking_pcn'
      ? RELEVANT_AREA_HINTS.parking
      : taxonomySlug === 'defamation_media'
        ? RELEVANT_AREA_HINTS.defamation
        : taxonomySlug === 'family' || matterType === 'family'
          ? RELEVANT_AREA_HINTS.family
          : taxonomySlug === 'debt' || matterType === 'debt'
            ? RELEVANT_AREA_HINTS.debt
            : taxonomySlug === 'personal_injury' || matterType === 'personal_injury'
              ? RELEVANT_AREA_HINTS.personal_injury
              : wantCar || matterType === 'consumer'
                ? RELEVANT_AREA_HINTS.car
                : matterType === 'housing'
                  ? RELEVANT_AREA_HINTS.housing
                  : matterType === 'employment'
                    ? RELEVANT_AREA_HINTS.employment
                    : matterType === 'immigration'
                      ? RELEVANT_AREA_HINTS.immigration
                      : matterType === 'crime'
                        ? RELEVANT_AREA_HINTS.crime
                        : RELEVANT_AREA_HINTS.litigation

  const matched = areas.filter((a) => hint.test(a))
  const pool =
    taxonomySlug === 'parking_pcn' || taxonomySlug === 'consumer_vehicle_repair'
      ? (matched.length ? matched : areas).filter((a) => !/employment|criminal/i.test(a))
      : matched
  if (pool.length) {
    const shown = pool.slice(0, 4)
    if (matterType === 'crime') {
      return shown.filter((a) => !/motoring|parking|\bpcn\b/i.test(a) || /criminal/i.test(a))
    }
    return shown
  }
  return areas
    .filter((a) => !/intellectual property/i.test(a))
    .filter((a) => !/employment/i.test(a) || matterType === 'employment')
    .slice(0, 3)
}

export function sraMatchReason(
  workAreaRaw: string,
  payload: Pick<
    SraSearchPayload,
    | 'matterType'
    | 'wantCar'
    | 'wantConsumer'
    | 'wantMotoring'
    | 'wantEmployment'
    | 'wantDefamation'
    | 'wantFamily'
    | 'wantDebt'
    | 'wantPersonalInjury'
    | 'wantLitigation'
    | 'wantCrime'
    | 'taxonomySlug'
    | 'query'
  >,
): string {
  const areas = relevantWorkAreas(
    workAreaRaw,
    payload.matterType,
    payload.wantCar,
    payload.taxonomySlug,
  )
  if (payload.wantDefamation || payload.taxonomySlug === 'defamation_media') {
    if (areas.some((a) => /defamation|libel|slander/i.test(a))) {
      return 'Listed for defamation / reputation work — confirm they take claimant or defendant instructions'
    }
    if (areas.some((a) => /media/i.test(a))) {
      return 'Listed for media work — confirm they handle online reputation / publication disputes'
    }
    if (areas.some((a) => /litigation/i.test(a))) {
      return 'Civil litigation practice — confirm they take defamation or publication disputes'
    }
  }
  if (payload.wantFamily && areas.some((a) => /family|children|matrimonial|divorce/i.test(a))) {
    return 'Listed for family work — confirm they take your type of family matter'
  }
  if (payload.wantDebt && areas.some((a) => /debt|insolvency|bankrupt/i.test(a))) {
    return 'Listed for debt / insolvency work — confirm they advise individuals'
  }
  if (
    payload.wantPersonalInjury &&
    areas.some((a) => /personal injury|clinical|medical negligence|accident/i.test(a))
  ) {
    return 'Listed for personal injury — confirm they take your type of claim'
  }
  if (payload.wantLitigation && areas.some((a) => /litigation/i.test(a))) {
    return 'Civil litigation practice — confirm they take this kind of dispute'
  }
  if (payload.taxonomySlug === 'parking_pcn') {
    if (areas.some((a) => /consumer/i.test(a))) {
      return 'Listed for Consumer work — confirm they take private parking / PCN disputes'
    }
    if (areas.some((a) => /litigation/i.test(a))) {
      return 'Local litigation practice — confirm they take parking charge / small-claims work'
    }
  }
  if (payload.wantMotoring) {
    if (areas.some((a) => /motoring|crime|criminal|road traffic|\brta\b|parking/i.test(a))) {
      return 'Listed for Motoring / RTA work — confirm they take driving / PCN matters'
    }
  }
  if (storyLooksEmployerSeizedKit(payload.query || '')) {
    if (payload.wantEmployment || payload.matterType === 'employment') {
      return 'Employment / commercial listing — recovering employer property from the police, not criminal defence for the arrested person'
    }
    if (payload.matterType === 'crime' && areas.some((a) => /crime|criminal/i.test(a))) {
      return 'Criminal defence listing — for the arrested person (police station / magistrates), not for recovering employer property from the police'
    }
  }
  if ((payload.wantCrime || payload.matterType === 'crime') && !payload.wantMotoring) {
    if (areas.some((a) => /crime|criminal/i.test(a))) {
      return 'Listed for criminal defence — confirm they take police station / magistrates work'
    }
  }
  if (payload.wantCar && areas.some((a) => /consumer/i.test(a))) {
    return 'Listed for Consumer work — check they take motor / faulty-goods disputes'
  }
  if (payload.wantConsumer && areas.some((a) => /consumer/i.test(a))) {
    return 'Listed for Consumer work on the SRA register'
  }
  if (areas.length) return `Relevant SRA work areas: ${areas.join(', ')}`
  return 'Matched from SRA register — verify specialism on their profile'
}

export type MatchingHelpLane = 'arrested_person' | 'employer_property'

export function matchingHelpLanesForStory(story: string): MatchingHelpLane[] {
  return storyLooksEmployerSeizedKit(story) ? ['arrested_person', 'employer_property'] : []
}

export function employerPropertySraFlags(query: string) {
  return resolveSraSearchFlags({
    matterType: 'employment',
    query,
    taxonomySlug: 'employment',
    wantEmployment: true,
    wantHousing: false,
    wantConsumer: false,
    wantMotoring: false,
    wantDefamation: false,
    wantFamily: false,
    wantDebt: false,
    wantPersonalInjury: false,
    wantLitigation: false,
    wantCrime: false,
  })
}
