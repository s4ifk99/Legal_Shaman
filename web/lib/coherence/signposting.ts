import type { MatterType, SessionState } from './types'

export interface SignpostResource {
  name: string
  description?: string
  url?: string
  phone?: string
  links?: { text: string; url: string }[]
}

export interface SignpostSection {
  title: string
  matterTypes: MatterType[]
  resources: SignpostResource[]
}

export interface SignpostHit {
  id: string
  title: string
  type: string
  blurb: string
  url?: string
  phone?: string
  section: string
  score: number
}

interface Bundle {
  meta: { importedAt: string; sectionCount: number; resourceCount: number }
  sections: SignpostSection[]
}

let cache: Bundle | null = null

async function load(): Promise<Bundle> {
  if (cache) return cache
  const mod = await import('@/data/coherence/v1Signposting.json')
  cache = mod.default as Bundle
  return cache
}

function sessionText(session: SessionState): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.goal,
    session.matterType,
  ]
    .join(' ')
    .toLowerCase()
}

const GENERAL_HELP =
  /advicenow|advice now|lawworks|citizens advice|legal aid|pro bono|free advice|attorney general|guide to/

const OFF_TOPIC =
  /therap|counsell|intercultural|mental health charity|psycholog|wellbeing|well-being/

const IMMIGRATION_RELEVANT =
  /immig|asylum|refugee|migrant|visa|traffick|home office|oisc|settled|ilr|deport|nationality|citizenship/

/** Private / council parking charge stories (not used-car “car” alone). */
export function isParkingStoryText(text: string): boolean {
  const t = text.toLowerCase()
  if (/\b(car\s*park|parking|pcn|popla|parking (?:fine|ticket|charge|app)|private parking|penalty charge)\b/i.test(t)) {
    // Exclude pure used-car purchase unless parking language dominates
    if (
      /\b(buying|bought|purchased|dealer|mot\b|faulty (?:car|vehicle)|used car)\b/i.test(t) &&
      !/\b(car\s*park|parking|pcn|popla)\b/i.test(t)
    ) {
      return false
    }
    return true
  }
  return false
}

function scoreResource(
  r: SignpostResource,
  text: string,
  section: SignpostSection,
  matterBoost: boolean,
  matter: MatterType,
): number {
  const hay = `${r.name} ${r.description || ''}`.toLowerCase()
  let score = 0
  const parkingStory = isParkingStoryText(text)

  // Curated section for this matter type — always surface top resources
  if (section.matterTypes.includes(matter)) score += 5

  // Base: section relevance only if content also looks useful for the matter
  if (matterBoost && section.title === 'Immigration and Citizenship') score += 5
  if (matterBoost && section.title === 'Consumer Rights') score += 5
  if (matterBoost && section.title === 'Home and Housing') score += 8
  if (matterBoost && section.title === 'Driving and Parking') score += parkingStory ? 12 : 4
  if (matterBoost && section.title === 'Getting Help' && GENERAL_HELP.test(hay)) score += 4
  if (matterBoost && section.title === 'Getting Help' && !GENERAL_HELP.test(hay)) score += 0

  const tokens = text.split(/[^a-z0-9+]+/).filter((t) => t.length > 3).slice(0, 30)
  for (const t of tokens) {
    if (hay.includes(t)) score += 2
  }

  if (/asylum|refugee|traffick/.test(text) && /asylum|refugee|traffick/.test(hay)) score += 8
  if (
    /housing|evict|homeless|tenant|landlord|flatmate|roommate|rent|deposit|notice to quit|section 21|possession/.test(
      text,
    ) &&
    /housing|evict|homeless|shelter|tenant|landlord|rent|deposit|hlpas|leasehold|possession/.test(hay)
  ) {
    score += 8
  }
  // Prefer housing orgs over generic Getting Help when matter is housing
  if (matter === 'housing' && section.title === 'Getting Help' && !GENERAL_HELP.test(hay)) {
    score -= 6
  }
  if (matter === 'housing' && /leasehold|park home|fire safety/.test(hay) && !/leasehold|flat|commonhold/.test(text)) {
    score -= 8
  }
  if (/domestic|abuse/.test(text) && /domestic|abuse|refuge/.test(hay)) score += 6
  // Used-car / goods — skip when this is a parking story ("car park" ≠ used car)
  if (
    !parkingStory &&
    /\b(car|vehicle|dealer|garage|fault|refund|consumer|warranty|trader)\b/.test(text) &&
    /consumer|fault|refund|car|vehicle|resolver|which/.test(hay)
  ) {
    score += 8
  }
  if (/\bilr\b|visa|refus|appeal|immigration/.test(text) && IMMIGRATION_RELEVANT.test(hay)) score += 6
  if (parkingStory) {
    if (/parking|pcn|popla|tribunal|motoring|ticket|fine/i.test(hay)) score += 14
    if (/yellow box/i.test(hay) && !/yellow box/i.test(text)) score -= 8
    if (/employment|acas|workplace|unfair dismiss|used.?car|faulty goods/i.test(hay)) score -= 16
    if (section.title === 'Getting Help' && parkingStory) {
      if (!/citizens advice|legal aid|pro bono|advicenow|lawworks|resolver/i.test(hay)) score -= 12
      if (/guide to pro bono/i.test(hay)) score -= 8
    }
    if (/immig|asylum|visa|traffick|domestic abuse|stalking|housing|evict|debt|bailiff/i.test(hay))
      score -= 18
  }
  if (GENERAL_HELP.test(hay) && /help|advice|solicitor|adviser|legal/.test(text)) score += 3

  // Drop weak / off-topic matches (e.g. intercultural therapy for an ILR refusal)
  if (OFF_TOPIC.test(hay) && !/therap|counsell|mental|trauma|wellbeing/.test(text)) {
    score -= 20
  }
  // Children's migrant projects are weak for adult ILR unless children mentioned
  if (/children|child's|coram/.test(hay) && !/child|children|minor|uasc/.test(text)) {
    score -= 8
  }
  // Trafficking units unless trafficking/asylum exploitation language present
  if (/traffick|atleu|kalayaan/.test(hay) && !/traffick|slave|asylum|exploit|domestic worker/.test(text)) {
    score -= 10
  }

  return score
}

/** Match curated V1 signposting resources for the session matter. */
export async function matchSignposting(
  session: SessionState,
  limit = 6,
): Promise<SignpostHit[]> {
  const bundle = await load()
  const text = sessionText(session)
  const matter = session.matterType
  const parkingStory =
    session.taxonomySlug === 'parking_pcn' || isParkingStoryText(text)
  const hits: SignpostHit[] = []

  for (const section of bundle.sections) {
    const matterBoost =
      section.matterTypes.includes(matter) ||
      (matter === 'unknown' && section.title === 'Getting Help') ||
      (parkingStory && section.title === 'Driving and Parking')
    if (!matterBoost && section.title !== 'Getting Help') continue

    for (const r of section.resources) {
      const score = scoreResource(r, text, section, matterBoost, matter)
      // Stricter floor so weak token overlaps (e.g. therapy orgs) do not appear
      const floor =
        section.matterTypes.includes(matter) || (parkingStory && section.title === 'Driving and Parking')
          ? 5
          : 6
      if (score < floor) continue
      hits.push({
        id: `signpost:${section.title}:${r.name}`.toLowerCase().replace(/\s+/g, '-'),
        title: r.name,
        type: `Signpost · ${section.title}`,
        blurb: r.description || '',
        url: r.url || r.links?.[0]?.url,
        phone: r.phone,
        section: section.title,
        score,
      })
    }
  }

  hits.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const out: SignpostHit[] = []
  for (const h of hits) {
    const sectionCount = out.filter((x) => x.section === h.section).length
    if (sectionCount >= 3) continue
    if (seen.has(h.title)) continue
    seen.add(h.title)
    out.push(h)
    if (out.length >= limit) break
  }

  // Hard fallback: parking stories always get CA + POPLA if scorers returned nothing useful
  if (parkingStory && !out.some((h) => /parking|popla|pcn/i.test(h.title))) {
    const fallbacks: SignpostHit[] = [
      {
        id: 'signpost:fallback:ca-parking',
        title: 'Citizens Advice — parking tickets and PCNs',
        type: 'Signpost · Driving and Parking',
        blurb: 'Challenge a council or private parking ticket — appeals and POPLA.',
        url: 'https://www.citizensadvice.org.uk/law-and-courts/parking-tickets/when-to-appeal-a-parking-ticket/',
        section: 'Driving and Parking',
        score: 100,
      },
      {
        id: 'signpost:fallback:popla',
        title: 'POPLA — Parking on Private Land Appeals',
        type: 'Signpost · Driving and Parking',
        blurb: 'Independent appeal for private parking charges.',
        url: 'https://www.popla.co.uk/',
        section: 'Driving and Parking',
        score: 99,
      },
      {
        id: 'signpost:fallback:govuk-parking',
        title: 'GOV.UK — parking tickets',
        type: 'Signpost · Driving and Parking',
        blurb: 'Official overview of parking tickets and how to challenge them.',
        url: 'https://www.gov.uk/parking-tickets',
        section: 'Driving and Parking',
        score: 98,
      },
    ]
    return [...fallbacks, ...out].slice(0, Math.max(limit, 3))
  }

  return out
}

export async function signpostingInfo() {
  const bundle = await load()
  return bundle.meta
}
