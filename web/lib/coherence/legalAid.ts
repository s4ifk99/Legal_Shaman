import { extractPostcodeArea, isLondonHint, londonLocationBoost } from './geo'
import type { SessionState } from './types'

export interface LegalAidListing {
  id: string
  businessName: string
  contactName: string
  phone: string
  email: string
  address: string
  city: string
  postcode: string
  category: string
  subcategory: string
  description: string
  legalAidGovCategory: string
  isLegalAid: true
}

export interface LegalAidHit {
  id: string
  title: string
  type: string
  blurb: string
  url?: string
  phone?: string
  postcode: string
  city: string
  score: number
}

interface Bundle {
  meta: {
    importedAt: string
    sourcePulledAt: string | null
    sourcePage: string | null
    immigrationListings: number
  }
  listings: LegalAidListing[]
}

let cache: Bundle | null = null

async function load(): Promise<Bundle> {
  if (cache) return cache
  const mod = await import('@/data/coherence/v1LegalAidImmigration.json')
  cache = mod.default as Bundle
  return cache
}

/**
 * Match immigration / asylum legal aid providers from the GOV.UK directory dump.
 * Ranks by postcode area / city overlap with session.locationHint.
 * "London" prefers true London postcodes over the broad "London and South East" label.
 */
export async function matchLegalAid(
  session: SessionState,
  limit = 5,
): Promise<LegalAidHit[]> {
  const bundle = await load()
  const hint = (session.locationHint || '').trim()
  if (!hint && session.jurisdiction === 'Unknown') {
    return bundle.listings.slice(0, Math.min(3, limit)).map((l, i) => toHit(l, 1 - i * 0.01))
  }

  const area = extractPostcodeArea(hint)
  const cityNeedle = hint.toLowerCase().replace(/[^a-z\s]/g, ' ').trim()
  const london = isLondonHint(hint)
  const scored = bundle.listings.map((l) => {
    let score = 1
    const pc = (l.postcode || '').toUpperCase()
    const city = (l.city || '').toLowerCase()

    if (area && pc.startsWith(area)) score += 12

    if (london) {
      score += londonLocationBoost(hint, l.city, l.postcode)
    } else if (cityNeedle && city) {
      if (city === cityNeedle || city.startsWith(cityNeedle + ' ')) score += 10
      else if (city.includes(cityNeedle) || cityNeedle.includes(city)) score += 6
    }

    if (!london && cityNeedle && (l.address || '').toLowerCase().includes(cityNeedle)) score += 4
    if (/\basylum\b/i.test(session.rawInputs.join(' ')) && /asylum/i.test(l.description)) score += 3
    return { l, score }
  })

  scored.sort((a, b) => b.score - a.score)
  // For London, require at least a weak London signal so random SE-labelled rows don't dominate
  const floor = london ? 4 : 1
  const top = scored.filter((x) => x.score > floor).slice(0, limit)
  const chosen = top.length ? top : scored.slice(0, Math.min(3, limit))
  return chosen.map(({ l, score }) => toHit(l, score))
}

function toHit(l: LegalAidListing, score: number): LegalAidHit {
  const place = [l.city, l.postcode].filter(Boolean).join(' · ')
  const blurb = [
    l.legalAidGovCategory ? `Legal aid · ${l.legalAidGovCategory}` : 'Legal aid provider',
    place,
    l.description.replace(/^Legal aid provider[^.]*\.\s*/i, '').slice(0, 140),
  ]
    .filter(Boolean)
    .join(' — ')

  return {
    id: `legal-aid:${l.id}`,
    title: l.businessName,
    type: 'Legal aid lawyer',
    blurb,
    phone: l.phone || undefined,
    postcode: l.postcode,
    city: l.city,
    score,
    url: 'https://www.gov.uk/legal-aid/search-for-legal-advice',
  }
}

export async function legalAidInfo() {
  const bundle = await load()
  return bundle.meta
}
