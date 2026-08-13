import rules from '@/data/coherence/layNormalisations.json'

/** Apply shared lay-person spelling normalisations (case-insensitive). */
export function normaliseLayText(text: string): string {
  let out = text
  for (const [pattern, replacement] of rules.replacements) {
    // Special-case deportation stem so "deortation" → "deportation"
    if (pattern.includes('deort')) {
      out = out.replace(/\bdeortation\b/gi, 'deportation')
      out = out.replace(/\bdeort(?:ed)?\b/gi, 'deported')
      continue
    }
    out = out.replace(new RegExp(pattern, 'gi'), replacement)
  }
  // Preserve ILR casing after lower-case-friendly passes
  out = out.replace(/\bilr\b/gi, 'ILR')
  return out
}
