import rules from '@/data/coherence/layNormalisations.json'

/** Fold curly quotes so "don't" / "what's" match ASCII intake filters. */
export function foldTypographicPunctuation(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
}

/** Apply shared lay-person spelling normalisations (case-insensitive). */
export function normaliseLayText(text: string): string {
  let out = foldTypographicPunctuation(text)
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
