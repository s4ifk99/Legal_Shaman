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

/**
 * True when the client is challenging a Home Office / visa decision.
 * False for prospective “I need a family visa” apply-first asks — and for
 * “there was no refusal” style denials (the word “refusal” alone must not flip the track).
 */
export function looksVisaRefusalOrChallenge(text: string): boolean {
  const t = text.toLowerCase()
  const cleaned = t
    .replace(
      /\b(no|not|never|haven'?t|have not|didn'?t|did not|wasn'?t|was not|weren'?t|were not)\s+(a\s+|been\s+|any\s+)?(refusal|refused|reject(?:ed|ion)?)\b/gi,
      ' ',
    )
    .replace(/\bthere (?:was|is) no refusal\b/gi, ' ')
    .replace(/\bwithout (?:a )?refusal\b/gi, ' ')

  const challengeCue =
    /\b(refus(?:al|ed)?|reject(?:ed|ion)?|administrative review|\bappeal\b|tribunal)\b/.test(cleaned)
  if (!challengeCue) return false

  // Bare “appeal” in non-immigration text should not win; need an immigration anchor.
  return looksImmigration(t) || /\b(decision|home office|ukvi|entry clearance)\b/.test(t)
}

/** Prospective visa / leave application — not (yet) a refusal challenge. */
export function looksProspectiveVisaApplication(text: string): boolean {
  const t = text.toLowerCase()
  if (looksVisaRefusalOrChallenge(t)) return false
  return (
    /\b(need|want|looking for|how (?:do|can) i|apply(?:ing)? for|get(?:ting)?)\b[\s\S]{0,48}\bvisa\b/.test(
      t,
    ) ||
    /\bvisa\b[\s\S]{0,24}\b(application|apply|apply(?:ing)?)\b/.test(t) ||
    /\b(need|want)\s+(a\s+)?(family|spouse|partner|fiancé|fiance|visit|student|work)\s+visa\b/.test(t)
  )
}

/**
 * Own driveway activity (wash / clean car) — informational, not a neighbour access fight.
 * Bare “driveway” must not lock neighbour-access packs.
 */
export function looksOwnDrivewayActivityQuestion(text: string): boolean {
  const t = text.toLowerCase()
  if (
    /\b(neighbour|neighbor|blocking|blocked|right of way|easement|shared (?:drive|access)|car\s*port|carport)\b/.test(
      t,
    )
  ) {
    return false
  }
  const onDriveway = /\b(on|in|at)\s+(my\s+|the\s+|our\s+)?driveway\b/.test(t) || /\bmy driveway\b/.test(t)
  if (!onDriveway && !/\bdriveway\b/.test(t)) return false

  const washClean =
    /\b(wash|washing|clean|cleaning|hose|pressure\s*wash(?:ing)?|valet|soapy\s+water|detergent)\b/.test(t) &&
    /\b(car|vehicle|van|bike|motorbike)\b/.test(t)

  const permissionAsk =
    /\b(can i|may i|am i allowed|is it (?:legal|ok|okay|allowed)|allowed to|illegal to)\b/.test(t) &&
    /\bdriveway\b/.test(t) &&
    !/\b(park(?:ing|ed)?\s+(?:on|across|blocking)|block(?:ing)?\s+access)\b/.test(t)

  return washClean || (permissionAsk && !/\b(park(?:ed|ing)|block)\b/.test(t))
}

/**
 * Neighbour / access disputes (driveway parking, boundary, noise) — still matter=housing
 * for routing, but must not be framed as landlord–tenant.
 */
export function looksNeighbourDispute(text: string): boolean {
  // Matter fork text contains "neighbour" — strip it so the fork alone cannot flip framing.
  const t = text
    .toLowerCase()
    .replace(/this is mainly about housing or a neighbour dispute/gi, ' ')
    .replace(/housing \/ neighbour/gi, ' ')

  if (looksOwnDrivewayActivityQuestion(t)) return false

  const tenancyCues =
    /\b(landlord|tenant|tenancy|section\s*21|section\s*8|disrepair|mould|mold|\brents?\b|evict|flatmate|housemate)\b/.test(
      t,
    )
  const neighbour = /\b(neighbour|neighbor)\b/.test(t)
  const accessCue =
    /\b(car\s*port|carport|parking|park(?:ed|ing)|boundary|fence|hedge|noise|nuisance|access|right of way|easement|blocking|party wall|extension|tree)\b/.test(
      t,
    )
  // Driveway alone is not enough — need conflict / third-party use of the drive
  const drivewayConflict =
    /\bdriveway\b/.test(t) &&
    /\b(block|blocked|blocking|park(?:ed|ing)|across|onto|shared|access|neighbour|neighbor)\b/.test(t) &&
    !/\b(wash|washing|clean|cleaning|hose|valet)\b/.test(t)

  if (neighbour && (accessCue || drivewayConflict || /\bdriveway\b/.test(t))) return true
  if (drivewayConflict && !tenancyCues) return true
  if (
    /\b(shared (?:drive|access)|right of way|easement|blocking access)\b/.test(t) &&
    !tenancyCues
  ) {
    return true
  }
  // User named a neighbour without tenancy language (not just the matter fork).
  if (neighbour && !tenancyCues) return true
  return false
}

/** Strong housing signals — never bare "rent" or "her house" (family disputes often say that). */
function looksHousing(t: string): boolean {
  if (looksOwnDrivewayActivityQuestion(t)) return false
  return /landlord|tenant|evict|lock(?:ed)?(?:\s+\w+){0,2}\s*out|mould|mold|\brents?\b|section\s*21|section\s*8|homeless|disrepair|tenancy|neighbour|neighbor|car\s*port|carport|easement|right of way|blocking access|planning permission|shared (?:drive|access)/.test(
    t,
  ) || looksNeighbourDispute(t)
}

/**
 * Separated parents / children / contact — including property fights over a child’s belongings.
 * Must beat bare “her house” language that otherwise bleeds to housing via LLM.
 */
function looksFamily(t: string): boolean {
  if (
    /\b(divorce|custody|child arrangement|child contact|care order|domestic abuse|non-molestation|family court)\b/i.test(
      t,
    )
  ) {
    return true
  }

  const child =
    /\b(\d+\s*year\s*old|my (?:sons?|daughters?|kids?|children|child)|his (?:mum|mom|mother)|her (?:dad|father)|picking (?:my|him|her) (?:sons?|daughters?) up)\b/i.test(
      t,
    )
  const otherParent =
    /\b(my ex|ex[- ]?(?:partner|wife|husband)|his mum|his mom|her boyfriend|boyfriend'?s kid|co[- ]?parent)\b/i.test(
      t,
    )
  if (child && otherParent) return true

  // Child’s gift / belongings damaged or withheld by the other parent
  if (
    child &&
    /\b(threw|broke|broken|taken it off|sue|get (?:it|them) (?:back|fixed)|can'?t afford a new)\b/i.test(t) &&
    /\b(ex|mum|mom|mother|dad|father|boyfriend)\b/i.test(t)
  ) {
    return true
  }

  return false
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

/** Private / council parking charges — not criminal “charge”, not used-car goods. */
function looksParking(t: string): boolean {
  return /\b(car\s*park|parking|pcn|popla|parking (?:fine|ticket|charge)|private parking|penalty charge)\b/i.test(
    t,
  )
}

/** Insurer / medical policy disputes — not workplace “policy” or employment. */
function looksInsurance(t: string): boolean {
  if (/\b(insurer|insurance (?:company|claim|policy)|private medical|bupa|axa)\b/i.test(t)) return true
  return (
    /\b(insurance|policy)\b/i.test(t) &&
    /\b(operation|hospital|won'?t pay|approved|claim|cover(?:age)?|treatment)\b/i.test(t)
  )
}

/** Event tickets / festivals — consumer, not debt. */
function looksEventTicket(t: string): boolean {
  return /\b(festival|concert|day ticket|ticket holders?|advertised artists?|\bgig\b|venue)\b/i.test(t)
}

/**
 * Disability / access (travel, wheelchairs) — not employment just because “employed as…”.
 * Workplace disability discrimination still goes through looksEmployment.
 */
function looksDisabilityAccess(t: string): boolean {
  const access =
    /\b(wheelchair|disabled|disability|blue badge|accessibility|stranded|assistance dog)\b/i.test(t) ||
    (/\bairport\b/i.test(t) && /\b(access|assistance|check-?in|wheelchair)\b/i.test(t))
  if (!access) return false
  if (
    /\b(dismiss|sacked|fired|redundan|holiday hours|holiday pay|unpaid wages|grievance|tribunal)\b/i.test(
      t,
    )
  ) {
    return false
  }
  return true
}

/**
 * Workplace disputes — including manager + hours / medical / holiday without “dismiss”.
 * Does not fire on bare “employed as…” or insurance “policy”.
 */
function looksEmployment(t: string): boolean {
  if (looksInsurance(t) || looksEventTicket(t) || looksParking(t)) return false
  if (looksDisabilityAccess(t)) return false

  if (
    /\b(employer|dismiss(?:ed|al)?|fired|sacked|redundan|employment tribunal|unfair dismiss|constructive dismiss|hasn'?t paid my (?:wage|pay)|unpaid (?:wage|overtime)|acas)\b/i.test(
      t,
    )
  ) {
    return true
  }

  const workplaceActor =
    /\b(manager|supervisor|boss|line manager|\bhr\b|my (?:job|work|shift)|at work|at my work)\b/i.test(t)
  const workplaceIssue =
    /\b(holiday (?:hours|pay|entitlement)|annual leave|shift(?:s)?|overtime|drs?\.? appointment|gp appointment|medical appointment|drinking water|work(?:ing)? hours|hours this year|work up or repay|clock(?:ing)? (?:in|out))\b/i.test(
      t,
    )
  if (workplaceActor && workplaceIssue) return true

  // Holiday hours / repay without naming a manager (common Reddit phrasing)
  if (
    /\b(holiday hours|holiday pay|annual leave)\b/i.test(t) &&
    /\b(company|shift|employer|repay|work up)\b/i.test(t)
  ) {
    return true
  }

  return false
}

function detectMatter(text: string): MatterType {
  const t = text.toLowerCase()
  if (/conveyanc|solicitor.*(buy|sell|purchase)|buying a (flat|house)|stamp duty/.test(t))
    return 'conveyancing'
  if (looksImmigration(t)) return 'immigration'
  if (/accident at work|workplace|injured|personal injury|\bpi\b|slipped|crash|whiplash/.test(t))
    return 'personal_injury'
  // Family (ex + child / belongings) before housing — "her house" must not win
  if (looksFamily(t)) return 'family'
  // Housing neighbour / access before consumer (carport ≠ used-car goods)
  if (looksHousing(t) && !/dealer|fault codes?|reject(?:ing)? (?:the )?car|board computer/.test(t))
    return 'housing'
  // Parking / PCN before crime — "parking charge" must not become criminal
  if (looksParking(t)) return 'consumer'
  // Motoring / disqualification before consumer (bare \"car\" must not flip to goods)
  if (looksMotoring(t)) return 'crime'
  // Insurance / tickets / disability access before employment keyword bleed
  if (looksInsurance(t) || looksEventTicket(t) || looksDisabilityAccess(t)) return 'consumer'
  // Consumer before housing: vehicle/goods purchase stories must not flip on substring \"rent\"
  if (looksConsumer(t) && !looksHousing(t)) return 'consumer'
  if (looksHousing(t)) return 'housing'
  if (looksEmployment(t)) return 'employment'
  if (looksFamily(t)) return 'family'
  if (/debt|bailiff|ccj|creditor|owed|owe money|county court judgment|enforcement/.test(t))
    return 'debt'
  if (looksConsumer(t)) return 'consumer'
  if (
    !looksParking(t) &&
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
  const place =
    text.match(
      /\b(Cornwall|Devon|Dorset|Somerset|Kent|Surrey|Essex|Sussex|Hampshire|Wiltshire|Norfolk|Suffolk|Cumbria|Yorkshire|Lancashire|Cheshire|Derbyshire|Nottinghamshire|Lincolnshire|Oxfordshire|Cambridgeshire|Warwickshire|Gloucestershire|Herefordshire|Worcestershire|Shropshire|Staffordshire|Northumberland|Durham|Berkshire|Buckinghamshire|Hertfordshire|Bedfordshire|Leicestershire|Northamptonshire|Rutland|London|Leeds|Manchester|Birmingham|Glasgow|Edinburgh|Belfast|Cardiff|Bristol|Liverpool|Sheffield|Newcastle|Oxford|Cambridge|Nottingham|Leicester|Coventry|Brighton|York|Plymouth|Truro|Exeter|Bath|Swindon|Reading|Milton Keynes|Southampton|Portsmouth|Norwich|Ipswich|Hull)\b/i,
    )?.[1] ?? ''
  const inPlace =
    text.match(/\bin\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?),\s*(?:England|Wales|Scotland)\b/)?.[1] ?? ''
  const locationHint = place || inPlace || ''

  if (/northern ireland|\bn\.?i\.?\b|belfast/.test(t))
    return { jurisdiction: 'NorthernIreland', locationHint: locationHint || 'Northern Ireland' }
  if (/scotland|glasgow|edinburgh|sheriff court/.test(t))
    return { jurisdiction: 'Scotland', locationHint: locationHint || 'Scotland' }
  if (
    /england|wales|london|leeds|manchester|birmingham|cardiff|cornwall|devon/.test(t) ||
    locationHint
  )
    return { jurisdiction: 'EnglandWales', locationHint }

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
    confirmedSearchQuery: '',
    reformulationOutcome: 'none',
    styleTranslatedQuery: '',
    searchContextTokens: [],
    searchIntent: 'unknown',
    abPrimaryMetric: 'unset',
    confirmedUserRole: 'unset',
    ukTaxonomyL1: '',
    ukTaxonomyL2: '',
    ukTaxonomyPackId: '',
    ukTaxonomyConfidence: 0,
    authorityAnswers: [],
    authorityHits: [],
    authorityAuditOk: false,
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
  if (
    looksNeighbourDispute(`${prev.rawInputs.join(' ')} ${text}`) &&
    !parties.some((p) => p.role === 'neighbour' || /neighbour|neighbor/i.test(p.label))
  ) {
    parties.push({ label: 'Neighbour', role: 'neighbour' })
  }
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
  const looksLikeJurisdictionChip =
    /^(england(?:\s+and\s+wales)?|wales|scotland|northern\s+ireland|uk|united\s+kingdom|london)$/i.test(
      text.trim(),
    )
  const looksLikeMatterFork =
    /^this is mainly about\b/i.test(text.trim()) ||
    /^getting help$/i.test(text.trim()) ||
    /^i (?:need|want) (?:general )?information\b/i.test(text.trim())
  const looksLikeStory =
    !looksLikeJurisdictionChip &&
    !looksLikeMatterFork &&
    text.length >= 28 &&
    (/(happened|when i|i was|i slipped|i fell|i complained|they|because|after|currently|apparently|neighbour|neighbor|driveway|parking|park(?:ed|ing)|landlord|tenant|employer|dismiss|refund|faulty)/i.test(
      text,
    ) ||
      (text.length >= 50 && !looksLikeGoalOnlyRequest(text)))
  if (looksLikeStory && !looksLikeGoalOnlyRequest(text)) {
    if (!whatHappened.trim()) {
      whatHappened = text
    } else if (looksLikeMultiBeatNarrative(text) || text.length > whatHappened.length + 20) {
      // Prefer a clearer problem statement over an earlier thin/meta line
      if (/^this is mainly about\b/i.test(whatHappened.trim()) || text.length >= whatHappened.length) {
        whatHappened = /^this is mainly about\b/i.test(whatHappened.trim())
          ? text
          : looksLikeMultiBeatNarrative(text)
            ? `${whatHappened} ${text}`
            : text.length > whatHappened.length
              ? text
              : `${whatHappened} ${text}`
      }
    }
  }
  // Always keep a substantial user problem statement as the story anchor
  if (!whatHappened.trim() || /^this is mainly about\b/i.test(whatHappened.trim())) {
    const opener = [...prev.rawInputs, text]
      .map((r) => r.trim())
      .filter(
        (r) =>
          r.length >= 28 &&
          !/^(england|wales|scotland|northern ireland|uk)$/i.test(r) &&
          !/^this is mainly about\b/i.test(r) &&
          !/^getting help$/i.test(r),
      )
      .sort((a, b) => b.length - a.length)[0]
    if (opener) whatHappened = opener
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
  // Neighbour parking / blocking already states the alleged wrongdoing
  if (
    !howCaused.trim() &&
    looksNeighbourDispute(`${prev.rawInputs.join(' ')} ${text}`) &&
    /park(?:ed|ing)|driveway|blocking|boundary|noise|nuisance/.test(lower)
  ) {
    howCaused = text.length >= 20 ? text.slice(0, 160) : 'Neighbour parking or access problem'
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
    taxonomySlug:
      looksParking(`${prev.whatHappened} ${text} ${prev.rawInputs.join(' ')}`)
        ? 'parking_pcn'
        : prev.taxonomySlug,
    softFlags,
    safetyRisk,
  }
}
