/**
 * Precision keyword matching for authority seeds.
 *
 * Grounded in Exa R&D hunt 20260820-203607:
 * - EXCISE (arXiv:2608.05497): additive token matching inflates false positives;
 *   demote/drop when exclusion cues dominate.
 * - Rhetorical-role / BM25 hybrid (arXiv:2608.06828): sparse lexical needs
 *   exact key terms, not substring containment.
 * - Lawyer LLaMA: filter weak / off-topic retrieved knowledge before surfacing.
 *
 * Product path: offline only — no Exa.
 */

export type SeedMatchPage = {
  id: string
  title: string
  url: string
  keywords: string[]
  /** Must match ≥1 of these (phrase/word-boundary) to keep the hit. */
  requireAny?: string[]
  /** EXCISE-style: if any match, drop or heavily demote this page. */
  excludeIf?: string[]
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Exact token or contiguous phrase — never substring (avoids car⊂care, rent⊂currently). */
export function keywordMatches(text: string, keyword: string): boolean {
  const k = (keyword || '').toLowerCase().trim()
  if (!k || !text) return false
  const body = text.toLowerCase()
  if (k.includes(' ')) {
    const escaped = escapeRegExp(k).replace(/\s+/g, '\\s+')
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(body)
  }
  return new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(body)
}

/** Longer phrases and rare tokens weigh more (BM25-ish idf proxy). */
export function keywordWeight(keyword: string): number {
  const k = keyword.toLowerCase().trim()
  const words = k.split(/\s+/).filter(Boolean)
  if (words.length >= 3) return 24
  if (words.length === 2) return 16
  // high-signal short legal/domain tokens (do not treat as stopwords)
  if (/^(iva|pip|pcn|nfa|gym|gdpr|dps)$/.test(k)) return 14
  // single tokens: punish ultra-common / short stopwords
  if (k.length <= 3) return 4
  if (
    /^(fine|ticket|appeal|cancel|service|goods|employer|victim|police|photos|purchase|debt|rent|car|child|member)$/.test(
      k,
    )
  ) {
    return 5
  }
  return 10
}

export function collectMatchedKeywords(text: string, keywords: string[]): string[] {
  const matched: string[] = []
  for (const kw of keywords) {
    if (keywordMatches(text, kw)) matched.push(kw)
  }
  return matched
}

export function exclusionFires(text: string, excludeIf?: string[]): boolean {
  if (!excludeIf?.length) return false
  return excludeIf.some((x) => keywordMatches(text, x))
}

export function requirementMet(text: string, requireAny?: string[]): boolean {
  if (!requireAny?.length) return true
  return requireAny.some((x) => keywordMatches(text, x))
}

export function matchScore(matched: string[]): number {
  return matched.reduce((s, kw) => s + keywordWeight(kw), 0)
}

/**
 * Keep hit only if:
 * - requirementMet
 * - no exclusion
 * - at least one strong match (weight≥10) OR ≥2 matched keywords
 * - total matchScore ≥ minScore
 */
export function isStrongEnoughHit(
  matched: string[],
  opts?: { minScore?: number },
): boolean {
  const minScore = opts?.minScore ?? 12
  if (!matched.length) return false
  const score = matchScore(matched)
  if (score < minScore) return false
  const hasStrong = matched.some((m) => keywordWeight(m) >= 10)
  if (hasStrong) return true
  return matched.length >= 2 && score >= 16
}

export function evaluateSeedPage(
  text: string,
  page: SeedMatchPage,
): { matched: string[]; excluded: boolean; ok: boolean; matchPts: number } {
  if (exclusionFires(text, page.excludeIf)) {
    return { matched: [], excluded: true, ok: false, matchPts: 0 }
  }
  if (!requirementMet(text, page.requireAny)) {
    return { matched: [], excluded: false, ok: false, matchPts: 0 }
  }
  const matched = collectMatchedKeywords(text, page.keywords)
  const matchPts = matchScore(matched)
  const ok = isStrongEnoughHit(matched)
  return { matched, excluded: false, ok, matchPts }
}
