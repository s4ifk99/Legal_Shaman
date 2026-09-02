/**
 * Offline Exa-learned authority index for Penumbra — reads authorityExaIndex.json only.
 * Used before live Exa API calls to cut cost and latency on cache miss.
 */
import exaIndex from '@/data/coherence/authority/authorityExaIndex.json'
import { isAllowedAuthorityUrl } from '@/lib/coherence/authorityAllowlist'
import { evaluateSeedPage } from '@/lib/coherence/authorityMatch'
import type { ExaSearchHit } from '@/lib/penumbra/exaSearch'

type ExaCachedPage = {
  id: string
  title: string
  url: string
  keywords: string[]
  requireAny?: string[]
  excludeIf?: string[]
  topicKeys?: string[]
  summary?: string
  highlights?: string[]
  source?: string
}

type ExaTopic = {
  topicKey: string
  sampleQueries?: string[]
  pageIds?: string[]
}

const PAGES = (exaIndex as { pages: ExaCachedPage[] }).pages
const TOPICS = (exaIndex as { topics: Record<string, ExaTopic> }).topics
const PAGE_BY_ID = new Map(PAGES.map((page) => [page.id, page]))

const MATTER_TO_AREA_TOPIC: Record<string, string> = {
  housing: 'area-housing-landlord-tenant',
  employment: 'area-employment-workplace',
  consumer: 'area-consumer-goods-traders',
  debt: 'area-debt-bailiffs-finance',
  family: 'area-family-children-divorce',
  immigration: 'area-immigration-visas',
  crime: 'area-crime-police-harassment',
  conveyancing: 'area-conveyancing-property-sale',
  personal_injury: 'area-medical-clinical-nhs',
}

export function penumbraOfflineExaEnabled(): boolean {
  const raw = process.env.PENUMBRA_OFFLINE_EXA_ENABLED?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return true
}

export function penumbraOfflineExaMinHits(): number {
  const parsed = Number(process.env.PENUMBRA_OFFLINE_EXA_MIN_HITS || 4)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 12) : 4
}

/** When false, never call live Exa API — offline index + hybrid merge only. */
export function penumbraLiveExaEnabled(): boolean {
  const raw = process.env.PENUMBRA_EXA_LIVE_ENABLED?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return true
}

function stableWebSourceId(url: string): string {
  const slug = url
    .replace(/^https?:\/\//i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `web-${slug || 'source'}`
}

function pageExcerpt(page: ExaCachedPage): string {
  const summary = String(page.summary || '').replace(/\s+/g, ' ').trim()
  if (summary.length >= 40) return summary.slice(0, 900)
  const highlight = Array.isArray(page.highlights)
    ? String(page.highlights[0] || '').replace(/\s+/g, ' ').trim()
    : ''
  if (highlight.length >= 40) return highlight.slice(0, 900)
  return `${page.title}. Official UK guidance page indexed for this topic.`.slice(0, 900)
}

function toHit(page: ExaCachedPage): ExaSearchHit {
  return {
    id: stableWebSourceId(page.url),
    url: page.url,
    title: page.title.slice(0, 240),
    excerpt: pageExcerpt(page),
  }
}

function tokenOverlapScore(query: string, corpus: string): number {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3)
    .slice(0, 24)
  let score = 0
  const body = corpus.toLowerCase()
  for (const token of tokens) {
    if (body.includes(token)) score += 2
  }
  return score
}

function matterTopicPages(matterSlug?: string): ExaCachedPage[] {
  const topicKey = MATTER_TO_AREA_TOPIC[(matterSlug || '').trim().toLowerCase()]
  if (!topicKey) return []
  const topic = TOPICS[topicKey]
  if (!topic?.pageIds?.length) return []
  return topic.pageIds
    .map((id) => PAGE_BY_ID.get(id))
    .filter((page): page is ExaCachedPage => Boolean(page))
}

function pagesForTopicKeys(topicKeys: string[]): ExaCachedPage[] {
  const out: ExaCachedPage[] = []
  const seen = new Set<string>()
  for (const key of topicKeys) {
    const topic = TOPICS[key]
    if (!topic?.pageIds?.length) continue
    for (const id of topic.pageIds) {
      const page = PAGE_BY_ID.get(id)
      if (!page || seen.has(page.url)) continue
      seen.add(page.url)
      out.push(page)
    }
  }
  return out
}

/** Match indexed sample queries (Exa fallback topics) to the live user story. */
function matchingTopicKeys(query: string, matterSlug?: string, limit = 4): string[] {
  const matterTopic = MATTER_TO_AREA_TOPIC[(matterSlug || '').trim().toLowerCase()]
  const scored: Array<{ key: string; score: number }> = []

  for (const [key, topic] of Object.entries(TOPICS)) {
    let score = 0
    for (const sample of topic.sampleQueries || []) {
      score = Math.max(score, tokenOverlapScore(query, sample))
    }
    if (key === matterTopic) score += 12
    if (score >= 6) scored.push({ key, score })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.key)
}

function scorePage(page: ExaCachedPage, query: string, matterSlug?: string): number {
  const ev = evaluateSeedPage(query.toLowerCase(), page)
  let score = ev.ok ? ev.matchPts : 0
  if (!ev.ok && score === 0) {
    score = tokenOverlapScore(query, `${page.title} ${page.summary || ''} ${page.keywords.join(' ')}`)
    if (score < 6) return 0
  }
  const matterTopic = MATTER_TO_AREA_TOPIC[(matterSlug || '').trim().toLowerCase()]
  if (matterTopic && page.topicKeys?.includes(matterTopic)) score += 20
  if (page.source === 'exa-fallback' || page.source === 'area-fill') score += 2
  return score
}

export type OfflineExaSearchResult = {
  hits: ExaSearchHit[]
  matchedPageCount: number
  matterTopicKey?: string
  matchedTopicKeys?: string[]
}

/** Rank pages from authorityExaIndex.json — no network. */
export function searchOfflineExaIndexForPenumbra(
  query: string,
  opts: { matterSlug?: string; limit?: number } = {},
): OfflineExaSearchResult {
  if (!penumbraOfflineExaEnabled()) {
    return { hits: [], matchedPageCount: 0 }
  }

  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 12)
  const matterTopicKey = MATTER_TO_AREA_TOPIC[(opts.matterSlug || '').trim().toLowerCase()]
  const matchedTopicKeys = matchingTopicKeys(query, opts.matterSlug)
  const scored = new Map<string, { page: ExaCachedPage; score: number }>()

  for (const page of PAGES) {
    if (!isAllowedAuthorityUrl(page.url)) continue
    const score = scorePage(page, query, opts.matterSlug)
    if (score <= 0) continue
    const existing = scored.get(page.url)
    if (!existing || score > existing.score) {
      scored.set(page.url, { page, score })
    }
  }

  for (const page of matterTopicPages(opts.matterSlug)) {
    if (!isAllowedAuthorityUrl(page.url)) continue
    const base = scored.get(page.url)?.score || 0
    const score = Math.max(base, 12 + scorePage(page, query, opts.matterSlug))
    scored.set(page.url, { page, score })
  }

  for (const page of pagesForTopicKeys(matchedTopicKeys)) {
    if (!isAllowedAuthorityUrl(page.url)) continue
    const base = scored.get(page.url)?.score || 0
    const score = Math.max(base, 10 + scorePage(page, query, opts.matterSlug))
    scored.set(page.url, { page, score })
  }

  const hits = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ page }) => toHit(page))

  return {
    hits,
    matchedPageCount: scored.size,
    matterTopicKey,
    matchedTopicKeys,
  }
}

export function mergeExaSearchHits(
  primary: ExaSearchHit[],
  secondary: ExaSearchHit[],
  limit: number,
): ExaSearchHit[] {
  const seen = new Set<string>()
  const out: ExaSearchHit[] = []
  for (const hit of [...primary, ...secondary]) {
    const key = hit.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
    if (out.length >= limit) break
  }
  return out
}
