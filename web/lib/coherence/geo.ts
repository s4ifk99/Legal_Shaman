/** Shared UK place / postcode helpers for Matching help ranking. */

/** Inner London outward-code prefixes (district letters only). */
const INNER_LONDON = /^(E|EC|N|NW|SE|SW|W|WC)\d/i

/** Greater London / fringe prefixes often used by London immigration providers. */
const GREATER_LONDON = /^(BR|CR|DA|EN|HA|IG|KT|RM|SM|TW|UB|WD)\d/i

export function extractPostcodeArea(hint: string): string | null {
  const m = hint.toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b/)
  if (m) return m[1]
  const area = hint.toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/)
  return area ? area[1] : null
}

export function isLondonHint(hint: string): boolean {
  return /\blondon\b/i.test(hint.trim())
}

export function londonPostcodeTier(postcode: string): 0 | 1 | 2 {
  const pc = (postcode || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!pc) return 0
  // Normalise to outward+digit form for prefix tests: EC4N6NP → EC4…
  const outward = pc.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)/)?.[1] || pc
  if (INNER_LONDON.test(outward)) return 2
  if (GREATER_LONDON.test(outward)) return 1
  return 0
}

export function londonCityTier(city: string): 0 | 1 | 2 {
  const c = (city || '').trim().toLowerCase()
  if (!c) return 0
  if (c === 'london' || /^london\b/.test(c) && !/south east|southeast/.test(c)) return 2
  if (/london/.test(c)) return 1 // e.g. "London and South East England"
  return 0
}

/** Score boost when the user said "London" (or similar). */
export function londonLocationBoost(hint: string, city: string, postcode: string): number {
  if (!isLondonHint(hint)) return 0
  const pcTier = londonPostcodeTier(postcode)
  const cityTier = londonCityTier(city)
  if (pcTier === 2) return 14
  if (pcTier === 1) return 9
  if (cityTier === 2) return 8
  if (cityTier === 1) return 3
  return 0
}
