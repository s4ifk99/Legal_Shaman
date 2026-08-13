import { isPcnAppealQuery, isVehicleRepairQuery } from '@/lib/legal/query-signals'
import { resolveTaxonomy } from '@/lib/legal/taxonomy-resolver'
import type { SessionState } from './types'
import type { LegalFrame } from './frames'

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
}

const EMPLOYMENT_DISPUTE =
  /\b(unfair dismiss|sacked|fired|redundan|acas|grievance|unpaid wages|holiday pay|settlement agreement|employment tribunal|rights at work)\b/i

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
      wantCar: false,
      wantConsumer: true,
      wantHousing: false,
      wantEmployment: false,
      wantImmigration: false,
      wantMotoring: true,
    }
  }
  if (taxonomySlug === 'criminal_defence' || matter === 'crime') {
    return {
      matterType: 'crime',
      query,
      taxonomySlug: taxonomySlug || 'criminal_defence',
      wantCar: false,
      wantConsumer: false,
      wantHousing: false,
      wantEmployment: false,
      wantImmigration: false,
      wantMotoring: true,
    }
  }
  if (taxonomySlug === 'consumer_vehicle_repair' || isVehicleRepairQuery(query)) {
    return {
      matterType: 'consumer',
      query,
      taxonomySlug: taxonomySlug || 'consumer_vehicle_repair',
      wantCar: true,
      wantConsumer: true,
      wantHousing: false,
      wantEmployment: false,
      wantImmigration: false,
      wantMotoring: false,
    }
  }
  if (taxonomySlug === 'housing' || taxonomySlug === 'neighbour_dispute') {
    return {
      matterType: 'housing',
      query,
      taxonomySlug,
      wantCar: false,
      wantConsumer: false,
      wantHousing: true,
      wantEmployment: false,
      wantImmigration: false,
      wantMotoring: false,
    }
  }
  if (taxonomySlug === 'conveyancing') {
    return {
      matterType: 'conveyancing',
      query,
      taxonomySlug,
      wantCar: false,
      wantConsumer: false,
      wantHousing: true,
      wantEmployment: false,
      wantImmigration: false,
      wantMotoring: false,
    }
  }
  if (taxonomySlug === 'employment') {
    return {
      matterType: 'employment',
      query,
      taxonomySlug,
      wantCar: false,
      wantConsumer: false,
      wantHousing: false,
      wantEmployment: true,
      wantImmigration: false,
      wantMotoring: false,
    }
  }
  if (taxonomySlug === 'immigration') {
    return {
      matterType: 'immigration',
      query,
      taxonomySlug,
      wantCar: false,
      wantConsumer: false,
      wantHousing: false,
      wantEmployment: false,
      wantImmigration: true,
      wantMotoring: false,
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

  return {
    matterType: matter,
    query,
    taxonomySlug,
    wantCar,
    wantConsumer,
    wantHousing,
    wantEmployment,
    wantImmigration,
    wantMotoring: Boolean(opts.wantMotoring),
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
      session.taxonomySlug === 'parking_pcn' || session.matterType === 'crime' ? true : undefined,
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

const RELEVANT_AREA_HINTS: Record<string, RegExp> = {
  consumer: /consumer|sale of goods|trader|commercial(?!.*corporate)/i,
  car: /consumer|motor|vehicle|litigation|dispute/i,
  parking: /motoring|motor|crime|road traffic|\brta\b|parking|consumer|litigation|dispute/i,
  housing: /housing|landlord|tenant|property.residential|disrepair/i,
  employment: /employment|workplace|tribunal|discriminat/i,
  immigration: /immigration|asylum|nationality/i,
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
      : wantCar || matterType === 'consumer'
        ? RELEVANT_AREA_HINTS.car
        : matterType === 'housing'
          ? RELEVANT_AREA_HINTS.housing
          : matterType === 'employment'
            ? RELEVANT_AREA_HINTS.employment
            : matterType === 'immigration'
              ? RELEVANT_AREA_HINTS.immigration
              : RELEVANT_AREA_HINTS.consumer

  const matched = areas.filter((a) => hint.test(a))
  const pool =
    taxonomySlug === 'parking_pcn' || taxonomySlug === 'consumer_vehicle_repair'
      ? (matched.length ? matched : areas).filter((a) => !/employment/i.test(a))
      : matched
  if (pool.length) return pool.slice(0, 4)
  return areas.filter((a) => !/employment/i.test(a) || matterType === 'employment').slice(0, 3)
}

export function sraMatchReason(
  workAreaRaw: string,
  payload: Pick<
    SraSearchPayload,
    'matterType' | 'wantCar' | 'wantConsumer' | 'wantMotoring' | 'taxonomySlug'
  >,
): string {
  const areas = relevantWorkAreas(
    workAreaRaw,
    payload.matterType,
    payload.wantCar,
    payload.taxonomySlug,
  )
  if (payload.taxonomySlug === 'parking_pcn' || payload.wantMotoring) {
    if (areas.some((a) => /motoring|crime|road traffic|\brta\b|parking/i.test(a))) {
      return 'Listed for Motoring / RTA work — confirm they take council PCN appeals'
    }
    if (areas.some((a) => /consumer/i.test(a))) {
      return 'Listed for Consumer / parking work — confirm they take PCN or RTA matters'
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
