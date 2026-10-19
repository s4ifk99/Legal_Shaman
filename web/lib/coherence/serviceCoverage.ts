/**
 * Where a matched service can actually help, and where the user is.
 * Matching help hides services that don't cover the user's nation / local area
 * and lists them separately so people know what they are missing and why.
 */
import { extractPostcodeArea, isLondonHint, londonPostcodeTier } from './geo'
import type { Jurisdiction, SessionState, UkNation } from './types'

export type { UkNation }

export const UK_NATIONS: readonly UkNation[] = ['england', 'wales', 'scotland', 'northern_ireland']

export const NATION_LABEL: Record<UkNation, string> = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
}

export type UserLocation = {
  input: string
  nation: UkNation | null
  london: boolean
  /** Postcode area letters, e.g. "LS" for LS1 4AB. */
  postcodeLetters: string | null
  postcodeDistrict: number | null
  /** Human label, e.g. "Leeds, England". */
  label: string
}

type LocalAreaId = 'london' | 'birmingham' | 'bristol' | 'cheshire_west'

const LOCAL_AREAS: Record<LocalAreaId, { label: string; test: (loc: UserLocation) => boolean }> = {
  london: { label: 'London', test: (loc) => loc.london },
  birmingham: {
    label: 'Birmingham',
    test: (loc) => loc.postcodeLetters === 'B' || /\bbirmingham\b/i.test(loc.input),
  },
  bristol: {
    label: 'Bristol',
    test: (loc) => loc.postcodeLetters === 'BS' || /\bbristol\b/i.test(loc.input),
  },
  cheshire_west: {
    label: 'Cheshire West and Chester',
    test: (loc) =>
      /\b(chester|cheshire west|ellesmere port|northwich|winsford|neston|frodsham)\b/i.test(loc.input) ||
      (loc.postcodeLetters === 'CH' && loc.nation === 'england') ||
      loc.postcodeLetters === 'CW',
  },
}

// ── Resolving the user's location ──────────────────────────────────────────

const SCOTLAND_AREAS = new Set([
  'AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE',
])
const WALES_AREAS = new Set(['CF', 'LD', 'LL', 'NP', 'SA'])

function nationForPostcode(letters: string, district: number | null): UkNation | null {
  if (letters === 'BT') return 'northern_ireland'
  if (letters === 'TD' && district === 15) return 'england' // Berwick-upon-Tweed
  if (SCOTLAND_AREAS.has(letters)) return 'scotland'
  if (WALES_AREAS.has(letters)) return 'wales'
  if (letters === 'SY' && district != null && district >= 15) return 'wales'
  if (letters === 'CH' && district != null && district >= 5 && district <= 8) return 'wales'
  if (letters === 'GY' || letters === 'JE' || letters === 'IM') return null
  return 'england'
}

const SCOTLAND_PLACES =
  /\b(scotland|scottish|glasgow|edinburgh|aberdeen|dundee|inverness|stirling|perth|paisley|kilmarnock|ayr|falkirk|livingston|dumfries|east kilbride|hamilton|motherwell|cumbernauld|greenock|kirkcaldy|dunfermline|fife|lanarkshire|highlands|orkney|shetland|lothian|ayrshire|renfrewshire|argyll|moray|angus|borders)\b/i
const WALES_PLACES =
  /\b(wales|welsh|cymru|cardiff|swansea|newport|wrexham|bangor|aberystwyth|carmarthen|llanelli|merthyr|pontypridd|bridgend|barry|caerphilly|neath|port talbot|rhyl|llandudno|anglesey|gwynedd|powys|pembrokeshire|ceredigion|conwy|denbighshire|flintshire|monmouthshire|rhondda|cwmbran|brecon)\b/i
const NI_PLACES =
  /\b(northern ireland|belfast|derry|londonderry|lisburn|newry|bangor,? (?:co\.? )?down|armagh|omagh|enniskillen|ballymena|coleraine|antrim|craigavon|portadown|county down|co\.? (?:down|antrim|armagh|tyrone|fermanagh|londonderry))\b|^ni$/i
const ENGLAND_PLACES =
  /\b(england|english|london|manchester|birmingham|sutton coldfield|solihull|leeds|liverpool|sheffield|bristol|newcastle|nottingham|leicester|coventry|bradford|hull|stoke|wolverhampton|derby|southampton|portsmouth|plymouth|brighton|reading|oxford|cambridge|norwich|ipswich|exeter|truro|bath|york|preston|blackpool|bolton|stockport|wigan|sunderland|middlesbrough|luton|milton keynes|northampton|peterborough|swindon|gloucester|cheltenham|worcester|hereford|shrewsbury|chester|lancaster|carlisle|durham|lincoln|canterbury|maidstone|chelmsford|colchester|southend|watford|slough|guildford|crawley|bournemouth|poole|salisbury|winchester|basingstoke|kent|surrey|essex|sussex|hampshire|devon|cornwall|dorset|somerset|wiltshire|norfolk|suffolk|yorkshire|lancashire|cheshire|cumbria|derbyshire|nottinghamshire|lincolnshire|oxfordshire|cambridgeshire|warwickshire|gloucestershire|herefordshire|worcestershire|shropshire|staffordshire|northumberland|berkshire|buckinghamshire|hertfordshire|bedfordshire|leicestershire|northamptonshire|rutland|merseyside|tyne and wear|west midlands)\b/i
const LONDON_PLACES =
  /\b(london|camden|islington|hackney|tower hamlets|southwark|lambeth|lewisham|greenwich|newham|haringey|enfield|barnet|brent|ealing|hounslow|hillingdon|harrow|richmond upon thames|kingston upon thames|merton|croydon|bromley|bexley|havering|barking|dagenham|redbridge|waltham forest|wandsworth|westminster|kensington|chelsea|hammersmith|fulham|brixton|peckham|wembley|walthamstow|tottenham)\b/i

const POSTCODE_RE = /^([A-Z]{1,2})(\d{1,2})[A-Z]?(?:\s*\d[A-Z]{2})?$/

export function resolveUserLocation(input: string, nationOverride?: UkNation | null): UserLocation {
  const trimmed = (input || '').trim().replace(/\s+/g, ' ')
  const upper = trimmed.toUpperCase()
  const pc = upper.match(POSTCODE_RE) || upper.match(/\b([A-Z]{1,2})(\d{1,2})[A-Z]?\s*\d[A-Z]{2}\b/)
  const postcodeLetters = pc ? pc[1] : null
  const postcodeDistrict = pc ? Number(pc[2]) : null

  let nation: UkNation | null = nationOverride ?? null
  if (!nation && postcodeLetters) nation = nationForPostcode(postcodeLetters, postcodeDistrict)
  if (!nation && trimmed) {
    if (NI_PLACES.test(trimmed)) nation = 'northern_ireland'
    else if (SCOTLAND_PLACES.test(trimmed)) nation = 'scotland'
    else if (WALES_PLACES.test(trimmed)) nation = 'wales'
    else if (ENGLAND_PLACES.test(trimmed) || LONDON_PLACES.test(trimmed)) nation = 'england'
  }

  const outward = pc ? (extractPostcodeArea(upper) || '') : ''
  const londonPostcode =
    Boolean(outward) &&
    londonPostcodeTier(outward) > 0 &&
    postcodeLetters !== 'WD' &&
    postcodeLetters !== 'DA'
  const london =
    nation === 'england' &&
    (londonPostcode ||
      isLondonHint(trimmed) ||
      LONDON_PLACES.test(trimmed))

  const place = trimmed
    ? trimmed.length <= 3 || /^(england|wales|scotland|northern ireland|ni)$/i.test(trimmed)
      ? ''
      : trimmed
    : ''
  const nationLabel = london
    ? /london/i.test(place) ? '' : 'London'
    : nation ? NATION_LABEL[nation] : ''
  const label = [place, nationLabel].filter(Boolean).join(', ') || trimmed

  return { input: trimmed, nation, london, postcodeLetters, postcodeDistrict, label }
}

function nationFromJurisdiction(j: Jurisdiction | undefined): UkNation | null {
  if (j === 'Scotland') return 'scotland'
  if (j === 'NorthernIreland') return 'northern_ireland'
  return null
}

export function jurisdictionForNation(nation: UkNation | null): Jurisdiction | null {
  if (nation === 'scotland') return 'Scotland'
  if (nation === 'northern_ireland') return 'NorthernIreland'
  if (nation === 'england' || nation === 'wales') return 'EnglandWales'
  return null
}

/** Location to filter Matching help by, or null when the user hasn't given one. */
export function resolveSessionLocation(session: SessionState): UserLocation | null {
  const hint = (session.locationHint || '').trim()
  const override = session.locationNation ?? nationFromJurisdiction(session.jurisdiction)
  if (!hint && !override) return null
  return resolveUserLocation(hint || NATION_LABEL[override!], override)
}

export function applyUserLocation(
  session: SessionState,
  input: string,
  nation: UkNation | null,
): SessionState {
  const trimmed = input.trim()
  if (!trimmed && !nation) {
    return { ...session, locationHint: '', locationNation: undefined }
  }
  return {
    ...session,
    locationHint: trimmed || (nation ? NATION_LABEL[nation] : ''),
    locationNation: nation ?? undefined,
    jurisdiction: jurisdictionForNation(nation) ?? session.jurisdiction,
  }
}

// ── Coverage of services ───────────────────────────────────────────────────

type AlternativeKind =
  | 'solicitor'
  | 'legal_aid'
  | 'citizens_advice'
  | 'housing'
  | 'domestic_abuse'
  | 'victim_support'
  | 'employment'

export type ServiceCoverage = {
  /** Nations served; omitted = whole UK. */
  nations?: UkNation[]
  /** Local service — only people in this area can use it. */
  area?: LocalAreaId
  /** Covers its nations except this area (e.g. TPT outside London). */
  exceptArea?: LocalAreaId
  kind?: AlternativeKind
}

export type ServiceIdentity = {
  id: string
  title: string
  url?: string
  type?: string
  sraId?: string
}

type Rule = {
  title?: RegExp
  host?: RegExp
  id?: RegExp
  coverage: ServiceCoverage
}

const EW: UkNation[] = ['england', 'wales']
const GB: UkNation[] = ['england', 'wales', 'scotland']

/** Ordered: first match wins. Only rules we are confident about — unknown = UK-wide. */
const RULES: Rule[] = [
  // Local services
  {
    title: /mary ward|toynbee hall|zacchaeus|\bz2k\b|nafsiyat|bloomsbury legal clinic|south west london law centres?|london employment rights hub|\bullac\b|legal advice centre \(london\)|london tribunals/i,
    host: /marywardlegal|swllc\.org|toynbeehall|z2k\.org|nafsiyat|londontribunals/i,
    coverage: { nations: ['england'], area: 'london' },
  },
  { title: /birmingham fraud clinic/i, coverage: { nations: ['england'], area: 'birmingham' } },
  { title: /supportive parents|send and you/i, host: /sendandyou/i, coverage: { nations: ['england'], area: 'bristol' } },
  { title: /cheshire west/i, host: /cheshirewestandchester/i, coverage: { nations: ['england'], area: 'cheshire_west' } },

  // Nation-specific
  { title: /citizens advice scotland|shelter scotland|\bscotland\b|\bscottish\b/i, host: /cas\.org\.uk|\.scot\b|scotland\./i, coverage: { nations: ['scotland'] } },
  { title: /northern ireland|advice ni\b/i, host: /adviceni|nidirect|housingadviceni/i, coverage: { nations: ['northern_ireland'] } },
  { title: /\bcymru\b/i, host: /gov\.wales|sheltercymru/i, coverage: { nations: ['wales'] } },
  { title: /traffic penalty tribunal/i, host: /trafficpenaltytribunal/i, coverage: { nations: EW, exceptArea: 'london' } },

  // Solicitors & legal aid regulated in England and Wales
  { id: /^legal-aid:/, coverage: { nations: EW, kind: 'legal_aid' } },
  { id: /^fs-(cla|legal-aid-agency)$/, title: /civil legal advice|legal aid agency|housing loss prevention|\bhlpas\b/i, coverage: { nations: EW, kind: 'legal_aid' } },
  { title: /\bsra\b|solicitors regulation authority|law society\b(?! of (?:scotland|northern ireland))/i, host: /sra\.org\.uk|lawsociety\.org\.uk/i, coverage: { nations: EW, kind: 'solicitor' } },
  { title: /england (?:&|and) wales/i, coverage: { nations: EW } },

  // England-only helplines and guidance
  { id: /^fs-(shelter|cab-adviceline-england)$/, title: /shelter england|\(england\)/i, host: /england\.shelter/i, coverage: { nations: ['england'] } },
  { id: /^fs-national-da-helpline$/, host: /nationaldahelpline/i, coverage: { nations: ['england'], kind: 'domestic_abuse' } },
  { host: /childlawadvice|justicefortenants/i, coverage: { nations: ['england'] } },
  { title: /\b(?:in|for) england\b|\bengland only\b|\bsection 21\b/i, coverage: { nations: ['england'] } },

  // England and Wales
  { id: /^fs-(cab-consumer-helpline|lease)$/, host: /lease-advice\.org|advicenow\.org\.uk|bpp\.com/i, coverage: { nations: EW } },
  { id: /^fs-victim-support$/, host: /victimsupport\.org\.uk/i, coverage: { nations: EW, kind: 'victim_support' } },
  { id: /^fs-(rights-of-women|frg)$/, host: /rightsofwomen|frg\.org\.uk|resolution\.org\.uk|flows\.org\.uk|publiclawproject|policeconduct\.gov\.uk|dls\.org\.uk|nacro\.org\.uk/i, coverage: { nations: EW } },

  // Great Britain (not Northern Ireland)
  { id: /^fs-(acas|national-debtline)$/, host: /acas\.org\.uk|nationaldebtline|equalityadvisoryservice/i, coverage: { nations: GB } },
]

function hostOf(url?: string): string {
  return (url || '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase()
}

function kindFromTitle(title: string): AlternativeKind | undefined {
  if (/citizens advice/i.test(title)) return 'citizens_advice'
  if (/shelter|housing/i.test(title)) return 'housing'
  if (/domestic abuse|domestic violence/i.test(title)) return 'domestic_abuse'
  if (/victim support/i.test(title)) return 'victim_support'
  if (/\bacas\b/i.test(title)) return 'employment'
  return undefined
}

const LOCAL_SERVICE = /law cent(?:re|er)|citizens advice|advice cent(?:re|er)|legal (?:advice )?clinic/i

/** "<Place> Law Centre" style names: local to that place. */
function localCoverage(title: string): ServiceCoverage | null {
  if (!LOCAL_SERVICE.test(title) || /\b(?:national|uk|england|wales|scotland)\b/i.test(title)) {
    return null
  }
  if (LONDON_PLACES.test(title)) return { nations: ['england'], area: 'london' }
  if (NI_PLACES.test(title)) return { nations: ['northern_ireland'] }
  if (SCOTLAND_PLACES.test(title)) return { nations: ['scotland'] }
  if (WALES_PLACES.test(title)) return { nations: ['wales'] }
  if (ENGLAND_PLACES.test(title)) return { nations: ['england'] }
  return null
}

/** citizensadvice.org.uk guidance pages are England unless under /wales/. */
function citizensAdviceCoverage(url?: string): ServiceCoverage | null {
  const m = /^https?:\/\/(?:www\.)?citizensadvice\.org\.uk(\/[^?#]*)?/i.exec(url || '')
  if (!m) return null
  const segments = (m[1] || '/').split('/').filter(Boolean)
  if (segments[0] === 'wales') return { nations: ['wales'] }
  if (segments[0] === 'scotland') return { nations: ['scotland'] }
  if (segments.length >= 2 && segments[0] !== 'about-us') return { nations: ['england'] }
  return null
}

export function coverageForService(s: ServiceIdentity): ServiceCoverage {
  if (s.sraId || /\bsra\b/i.test(s.type || '')) return { nations: EW, kind: 'solicitor' }
  const host = hostOf(s.url)
  for (const rule of RULES) {
    if (
      (rule.id && rule.id.test(s.id)) ||
      (rule.title && rule.title.test(s.title)) ||
      (rule.host && host && rule.host.test(host))
    ) {
      return { ...rule.coverage, kind: rule.coverage.kind ?? kindFromTitle(s.title) }
    }
  }
  const derived = localCoverage(s.title) ?? citizensAdviceCoverage(s.url)
  return derived ? { ...derived, kind: kindFromTitle(s.title) } : {}
}

function formatNations(nations: UkNation[]): string {
  const sorted = UK_NATIONS.filter((n) => nations.includes(n))
  if (sorted.length === 3 && !sorted.includes('northern_ireland')) return 'England, Scotland and Wales'
  const labels = sorted.map((n) => NATION_LABEL[n])
  return labels.length <= 1
    ? labels.join('')
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** Short tag for a result card, e.g. "England only" or "London only". */
export function coverageLabel(c: ServiceCoverage): string | null {
  if (c.area) return `${LOCAL_AREAS[c.area].label} only`
  if (!c.nations) return null
  const base = c.nations.length === 1 ? `${NATION_LABEL[c.nations[0]]} only` : formatNations(c.nations)
  return c.exceptArea ? `${base} (not ${LOCAL_AREAS[c.exceptArea].label})` : base
}

export type Alternative = { title: string; url: string }

const ALTERNATIVES: Partial<Record<UkNation, Partial<Record<AlternativeKind, Alternative>>>> = {
  scotland: {
    solicitor: { title: 'Law Society of Scotland — Find a Solicitor', url: 'https://www.lawscot.org.uk/find-a-solicitor/' },
    legal_aid: { title: 'Scottish Legal Aid Board', url: 'https://www.slab.org.uk/' },
    citizens_advice: { title: 'Citizens Advice Scotland', url: 'https://www.cas.org.uk/' },
    housing: { title: 'Shelter Scotland', url: 'https://scotland.shelter.org.uk/' },
    domestic_abuse: { title: "Scotland's Domestic Abuse and Forced Marriage Helpline", url: 'https://sdafmh.org.uk/' },
    victim_support: { title: 'Victim Support Scotland', url: 'https://victimsupport.scot/' },
  },
  northern_ireland: {
    solicitor: { title: 'Law Society of Northern Ireland', url: 'https://www.lawsoc-ni.org/' },
    legal_aid: { title: 'Legal aid in Northern Ireland (nidirect)', url: 'https://www.nidirect.gov.uk/articles/legal-aid-schemes' },
    citizens_advice: { title: 'Advice NI', url: 'https://www.adviceni.net/' },
    housing: { title: 'Housing Advice NI', url: 'https://www.housingadviceni.org/' },
    domestic_abuse: { title: 'Domestic and Sexual Abuse Helpline (NI)', url: 'https://www.dsahelpline.org/' },
    victim_support: { title: 'Victim Support NI', url: 'https://www.victimsupportni.com/' },
    employment: { title: 'Labour Relations Agency', url: 'https://www.lra.org.uk/' },
  },
  wales: {
    citizens_advice: { title: 'Citizens Advice Wales', url: 'https://www.citizensadvice.org.uk/wales/' },
    housing: { title: 'Shelter Cymru', url: 'https://sheltercymru.org.uk/' },
    domestic_abuse: { title: 'Live Fear Free (Wales)', url: 'https://www.gov.wales/live-fear-free' },
  },
}

export type Availability =
  | { available: true }
  | { available: false; reason: string; alternative?: Alternative }

export function availabilityAt(c: ServiceCoverage, loc: UserLocation | null): Availability {
  if (!loc) return { available: true }
  const alternative = loc.nation && c.kind ? ALTERNATIVES[loc.nation]?.[c.kind] : undefined

  if (c.area && !LOCAL_AREAS[c.area].test(loc)) {
    return {
      available: false,
      reason: `Local service — only helps people in ${LOCAL_AREAS[c.area].label}`,
      alternative,
    }
  }
  if (c.nations && loc.nation && !c.nations.includes(loc.nation)) {
    const reason =
      c.kind === 'solicitor'
        ? `Regulated in England and Wales — ${NATION_LABEL[loc.nation]} has its own law and solicitors`
        : `Only covers ${formatNations(c.nations)}`
    return { available: false, reason, alternative }
  }
  if (c.exceptArea && LOCAL_AREAS[c.exceptArea].test(loc)) {
    return {
      available: false,
      reason: `Doesn't cover ${LOCAL_AREAS[c.exceptArea].label}`,
      alternative:
        c.exceptArea === 'london'
          ? { title: 'London Tribunals', url: 'https://www.londontribunals.gov.uk/' }
          : undefined,
    }
  }
  return { available: true }
}
