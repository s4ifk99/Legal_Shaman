import type { Jurisdiction, MatterType, Mode, SessionState, TimelineEvent } from './types'
import { normaliseLayText } from './normaliseLay'
import {
  extractNarrativeEvents,
  looksLikeMultiBeatNarrative,
  mergeTimelineEvents,
  summariseToLabel,
} from './timelineExtract'

const uid = () => Math.random().toString(36).slice(2, 10)

function pushEvent(events: TimelineEvent[], label: string, rawSpan?: string, dateApprox?: string) {
  const exists = events.some(
    (e) => e.kind === 'event' && e.label.toLowerCase() === label.toLowerCase(),
  )
  if (exists) return
  events.push({ id: uid(), label, rawSpan, dateApprox, kind: 'event' })
}

/** Immigration only on clear immigration signals — not bare "refused". */
function looksImmigration(t: string): boolean {
  return /\bilr\b|indefinite leave|visa|deport|home office|asylum|immigration|settled status|leave to remain/.test(
    t,
  )
}

/** Strong housing signals — never bare "rent" (matches currently/different/apparently). */
function looksHousing(t: string): boolean {
  return /landlord|tenant|evict|lock(?:ed)?(?:\s+\w+){0,2}\s*out|mould|mold|\brents?\b|section\s*21|section\s*8|homeless|disrepair|tenancy|neighbour|neighbor|driveway|car\s*port|carport|easement|right of way|blocking access|planning permission|shared (?:drive|access)/.test(
    t,
  )
}

/** Goods / trader / vehicle purchase — not bare \"car\" (matches driving-ban stories). */
function looksConsumer(t: string): boolean {
  if (looksMotoring(t)) return false
  return /refund|faulty|consumer|guarantee|warranty|trader|goods|garage|washing machine|distance selling|service.*paid|refuse to fix|dealer|fault codes?|\bbattery\b|\bmot\b|broke down|not as described|bought.*\b(car|vehicle)\b|\bpurchased\b.*\b(car|vehicle)\b/.test(
    t,
  )
}

/** Driving ban / disqualification / in-charge / Highway Code — checked before consumer. */
function looksMotoring(t: string): boolean {
  return /driving ban|disqualif|banned from driving|motoring|highway code|in charge of (?:the )?vehicle|in control of (?:the )?vehicle|turn(?:ing)? the engine|inflate (?:the )?tyres?|tyre pressure|licence (?:ban|suspension)|disqualified from driving/.test(
    t,
  )
}

function detectMatter(text: string): MatterType {
  const t = text.toLowerCase()
  if (/conveyanc|solicitor.*(buy|sell|purchase)|buying a (flat|house)|stamp duty/.test(t))
    return 'conveyancing'
  if (looksImmigration(t)) return 'immigration'
  if (/accident at work|workplace|injured|personal injury|\bpi\b|slipped|crash|whiplash/.test(t))
    return 'personal_injury'
  // Housing neighbour / access before consumer (carport ≠ used-car goods)
  if (looksHousing(t) && !/dealer|fault codes?|reject(?:ing)? (?:the )?car|board computer/.test(t))
    return 'housing'
  // Motoring / disqualification before consumer (bare \"car\" must not flip to goods)
  if (looksMotoring(t)) return 'crime'
  // Consumer before housing: vehicle/goods purchase stories must not flip on substring \"rent\"
  if (looksConsumer(t) && !looksHousing(t)) return 'consumer'
  if (looksHousing(t)) return 'housing'
  if (
    /employer|dismiss|fired|sacked|redundan|tribunal|wages|unfair dismiss|constructive dismiss|hasn'?t paid my (wage|pay)/.test(
      t,
    )
  )
    return 'employment'
  if (/divorce|custody|child arrangement|child contact|domestic|partner left|care order/.test(t))
    return 'family'
  if (/debt|bailiff|ccj|creditor|owed|owe money|county court judgment|enforcement/.test(t))
    return 'debt'
  if (looksConsumer(t)) return 'consumer'
  if (
    /sentenc|magistrates|arrest|charg(?:ed|e)|bail|police station|criminal|offence|cps|witness statement|victim of crime|fraud|theft|assault|driving ban|disqualif|motoring/.test(
      t,
    )
  )
    return 'crime'
  if (/lawyer|solicitor|barrister|legal help|advice/.test(t)) return 'other'
  return 'unknown'
}

function detectMode(text: string, matter: MatterType): Mode {
  const t = text.toLowerCase()
  if (/urgent|immediate danger|homeless tonight|threaten|hit me|police/.test(t)) return 'urgent'
  if (
    /compare|near me|find a|looking for a|best |cost of|how much|recommend a|conveyancer/.test(t) ||
    matter === 'conveyancing'
  )
    return 'browse'
  if (
    /happen|happened|rejected|refused|accident|injured|locked|deported|fired|evict|complaint/.test(t)
  )
    return 'dispute'
  if (/what is|information|explain|understand/.test(t)) return 'info'
  return matter === 'unknown' ? 'unknown' : 'dispute'
}

function detectJurisdiction(text: string): { jurisdiction: Jurisdiction; locationHint: string } {
  const t = text.toLowerCase()
  let locationHint = ''
  const city =
    text.match(
      /\b(London|Leeds|Manchester|Birmingham|Glasgow|Edinburgh|Belfast|Cardiff|Bristol|Liverpool|Sheffield|Newcastle|Oxford|Cambridge|Nottingham|Leicester|Coventry|Brighton|York)\b/i,
    )?.[1] ?? ''
  if (city) locationHint = city

  if (/northern ireland|\bni\b|belfast/.test(t))
    return { jurisdiction: 'NorthernIreland', locationHint: locationHint || 'Northern Ireland' }
  if (/scotland|glasgow|edinburgh|sheriff court/.test(t))
    return { jurisdiction: 'Scotland', locationHint: locationHint || 'Scotland' }
  if (/england|wales|london|leeds|manchester|birmingham|cardiff/.test(t) || city)
    return { jurisdiction: 'EnglandWales', locationHint: locationHint || city }

  return { jurisdiction: 'Unknown', locationHint }
}

export function createInitialSession(): SessionState {
  return {
    rawInputs: [],
    events: [],
    whatHappened: '',
    howCaused: '',
    goal: '',
    parties: [],
    documents: [],
    matterType: 'unknown',
    jurisdiction: 'Unknown',
    locationHint: '',
    mode: 'unknown',
    softFlags: [],
    safetyRisk: false,
    answeredPromptIds: [],
    briefUnderstanding: '',
    clientQuestion: '',
    topicId: '',
  }
}

function looksLikeGoalOnlyRequest(text: string): boolean {
  const t = text.trim()
  if (t.length > 180) return false
  return /^(?:i (?:just )?want(?:\s+to)?|i need(?:\s+a)?|looking (?:for|to)|hoping to|find a conveyanc)/i.test(t)
}

/** Heuristic detail sensing for Phase 1 (no API required). */
export function senseDetails(rawInput: string, prev: SessionState): SessionState {
  const text = normaliseLayText(rawInput.trim())
  if (!text) return prev

  const lower = text.toLowerCase()
  let events = [...prev.events]
  const parties = [...prev.parties]
  const documents = [...prev.documents]
  const softFlags = [...prev.softFlags]

  const matterType =
    prev.matterType === 'unknown' ? detectMatter(text) : detectMatter(`${prev.rawInputs.join(' ')} ${text}`)
  // Honour explicit mode fork; otherwise sense from text
  const modeLocked = prev.answeredPromptIds.includes('mode_fork')
  const mode = modeLocked
    ? prev.mode
    : prev.mode === 'unknown' || prev.mode === 'browse'
      ? detectMode(text, matterType)
      : detectMode(`${prev.rawInputs.join(' ')} ${text}`, matterType)

  const { jurisdiction, locationHint } = (() => {
    const d = detectJurisdiction(text)
    return {
      jurisdiction: prev.jurisdiction === 'Unknown' ? d.jurisdiction : prev.jurisdiction,
      locationHint: d.locationHint || prev.locationHint,
    }
  })()

  // Dates (fallback for single-beat inputs)
  const year = text.match(/\b(19|20)\d{2}\b/)?.[0]
  const relative = text.match(/\b(last week|yesterday|today|last month|this year)\b/i)?.[0]

  // Timeline: split long narratives into multiple events; single beats get one event
  if (mode !== 'browse') {
    const extracted = extractNarrativeEvents(text)
    if (extracted.length) {
      events = mergeTimelineEvents(events, extracted)
    } else if (text.length > 24) {
      pushEvent(events, summariseToLabel(text), text.slice(0, 40), year || relative)
    }
  }

  // Parties from narrative
  if (/landlord/i.test(text) && !parties.some((p) => p.role === 'landlord'))
    parties.push({ label: 'Landlord', role: 'landlord' })
  if (/tenant/i.test(text) && !parties.some((p) => p.role === 'tenant'))
    parties.push({ label: 'Client (tenant)', role: 'tenant' })
  if (
    (/accident at work|workplace|employer|fired|dismiss|sacked/i.test(text) ||
      matterType === 'employment') &&
    !parties.some((p) => p.role === 'employer')
  ) {
    parties.push({ label: 'Employer', role: 'employer' })
  }
  if (/\bdealer\b|garage/i.test(text) && !parties.some((p) => /dealer|garage/i.test(p.label)))
    parties.push({ label: 'Dealer / garage', role: 'trader' })

  // Soft flags — never findings
  if (/bad character|criminal record|conviction/i.test(text)) {
    if (!softFlags.includes('character_concern_raised')) softFlags.push('character_concern_raised')
  }

  // Goal extraction
  let goal = prev.goal
  const goalMatch = text.match(
    /(?:i (?:just )?want(?: to)?|i need(?: to)?|looking (?:for|to)|hoping to)\s+(.+)/i,
  )
  if (goalMatch) {
    goal = goalMatch[1].replace(/[.?!].*$/, '').trim()
  } else if (mode === 'browse' && /conveyanc|solicitor|lawyer/i.test(text) && !goal) {
    goal = matterType === 'conveyancing' ? 'Find a conveyancer' : 'Find suitable legal help'
  } else if (/need a (?:pi |personal injury )?lawyer|need a solicitor/i.test(text) && !goal) {
    goal = 'Speak to a suitable solicitor'
  }

  // Documents
  if (/refusal letter|decision letter/i.test(text) && !documents.includes('Refusal letter'))
    documents.push('Refusal letter')
  if (/tenancy/i.test(text) && !documents.includes('Tenancy agreement')) documents.push('Tenancy agreement')
  if (/contract|payslip/i.test(text) && !documents.includes('Employment documents'))
    documents.push('Employment documents')

  const safetyRisk =
    prev.safetyRisk || /immediate danger|homeless tonight|threaten to (?:kill|hurt)|domestic abuse/i.test(lower)

  // Narrative / cause hints from free text (do not overwrite richer answers)
  let whatHappened = prev.whatHappened
  let howCaused = prev.howCaused
  const looksLikeStory =
    text.length >= 40 &&
    /(happened|when i|i was|i slipped|i fell|i complained|they|because|after|currently|apparently)/i.test(
      text,
    )
  if (
    (!whatHappened || looksLikeMultiBeatNarrative(text)) &&
    looksLikeStory &&
    !looksLikeGoalOnlyRequest(text)
  ) {
    whatHappened = prev.whatHappened ? `${prev.whatHappened} ${text}` : text
  }
  if (!whatHappened.trim() && events.filter((e) => e.kind === 'event').length >= 3) {
    const rich = [...prev.rawInputs, text].find(
      (r) => r.trim().length >= 120 && looksLikeMultiBeatNarrative(r),
    )
    if (rich) whatHappened = rich.trim()
  }
  const causeMatch = text.match(
    /(?:caused by|because|due to|fault of|they (?:didn’t|did not|failed)|unsafe|negligen)\s*.+/i,
  )
  if (!howCaused && causeMatch) {
    howCaused = causeMatch[0].trim()
  }

  return {
    ...prev,
    rawInputs: [...prev.rawInputs, text],
    events,
    whatHappened,
    howCaused,
    goal,
    parties,
    documents,
    matterType: matterType === 'unknown' ? prev.matterType : matterType,
    jurisdiction,
    locationHint,
    mode: mode === 'unknown' ? prev.mode : mode,
    softFlags,
    safetyRisk,
  }
}
