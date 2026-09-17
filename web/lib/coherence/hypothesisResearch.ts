/**
 * Light local wiki research for open hypothesis slots.
 * Intended for Node/API/scripts — do not import from client components
 * (wiki index is server-backed via load-index).
 */
import { searchWikiPages } from '@/lib/wiki/search'
import type { HypothesisEvidence, HypothesisSet } from './hypothesisProbe'
import { mergeHypothesisEvidence } from './hypothesisProbe'

function queryForSlug(slug: string): string {
  if (slug === 'employment') {
    return 'holiday entitlement annual leave rights at work reasonable adjustments'
  }
  if (slug === 'family') return 'child arrangements contact order family court'
  if (slug === 'housing') return 'private renting landlord tenant'
  return `${slug.replace(/_/g, ' ')} UK advice`
}

function classifyEvidence(slug: string, title: string): HypothesisEvidence['support'] {
  const t = title.toLowerCase()
  if (slug === 'employment') {
    if (/holiday|annual leave|rights at work|working time|reasonable adjust|discriminat|equality/i.test(t)) {
      return 'support'
    }
    if (/child arrangements|contact order|divorce|custody/i.test(t)) return 'contradict'
  }
  if (slug === 'family') {
    if (/child arrangements|contact order|divorce|custody|family court/i.test(t)) return 'support'
    if (/holiday entitlement|annual leave|rights at work/i.test(t)) return 'contradict'
  }
  return 'neutral'
}

/** Attach 1–3 local wiki titles per open hypothesis. */
export function attachLocalHypothesisEvidence(set: HypothesisSet, _story = ''): HypothesisSet {
  const evidenceBySlug: Record<string, HypothesisEvidence[]> = {}
  for (const h of set.hypotheses) {
    const hits = searchWikiPages(queryForSlug(h.slug), 4).slice(0, 3)
    evidenceBySlug[h.slug] = hits.map((hit) => ({
      title: hit.title,
      support: classifyEvidence(h.slug, hit.title),
    }))
  }
  return mergeHypothesisEvidence(set, evidenceBySlug)
}

export function evidenceMapForHypotheses(
  set: HypothesisSet,
): Record<string, HypothesisEvidence[]> {
  const out: Record<string, HypothesisEvidence[]> = {}
  for (const h of set.hypotheses) {
    const hits = searchWikiPages(queryForSlug(h.slug), 4).slice(0, 3)
    out[h.slug] = hits.map((hit) => ({
      title: hit.title,
      support: classifyEvidence(h.slug, hit.title),
    }))
  }
  return out
}
