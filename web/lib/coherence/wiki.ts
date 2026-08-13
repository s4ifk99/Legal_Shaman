import type { Jurisdiction, MatterType, SessionState } from './types'
import type { LegalFrame } from './frames'
import type { KnowledgeHit } from './knowledgeTypes'
import {
  buildHeuristicRightsSummary,
  loadSourceSnippets,
  type SourceSnippet,
} from './oslawSummary'
import type { RightsSummary } from './oslawRights'
import {
  buildRightsFromWiki,
  featuredToolsFromWiki,
  linkedTopicPages,
  synthesizeStepsFromWiki,
} from './wikiOslaw'

export type WikiPageKind = 'topic' | 'pathway' | 'entity' | 'index' | 'tool'
export type WikiDomainId =
  | 'immigration'
  | 'housing'
  | 'employment'
  | 'debt'
  | 'family'
  | 'consumer'
  | 'crime'

export interface WikiPage {
  id: string
  kind: WikiPageKind
  title: string
  jurisdiction: string
  frameIds: string[]
  primaryUrl: string
  sourceIds: string[]
  sourceUrls: string[]
  contradictions: string[]
  snippet: string
  path: string
  keywords: string[]
  authority?: 'primary' | 'secondary' | 'tertiary'
  /** Compiled OSLAW rights overview (Karpathy wiki compile) */
  oslawRightsOverview?: string
  oslawRightsBullets?: { text: string; sourceTitle?: string; sourceUrl?: string }[]
  oslawSteps?: {
    id: string
    label: string
    detail: string
    sourceUrl?: string
    sourceTitle?: string
    toolId?: string
    when?: string
  }[]
  oslawToolIds?: string[]
  oslawOrigin?: 'rules' | 'llm'
  oslawEnrichedAt?: string
  linkedTopicIds?: string[]
  toolMeta?: {
    url: string
    detail: string
    when?: string
    provider?: string
    pathwayIds?: string[]
  }
}

export interface WikiHit extends KnowledgeHit {
  kind: WikiPageKind
  frameIds: string[]
  jurisdiction: string
  contradictions: string[]
  sourceIds: string[]
  sourceUrls?: string[]
  domainId?: WikiDomainId
  authority?: 'primary' | 'secondary' | 'tertiary'
}

/** OSLAW: ranked wiki pathways turned into a practical course of action (not legal advice). */
export interface OslawCourseStep {
  id: string
  label: string
  detail: string
  url?: string
  /** Human title for the linked open source */
  sourceTitle?: string
}

export interface OslawCourse {
  pathwayId: string
  title: string
  summary: string
  domainId?: WikiDomainId
  authority?: string
  primaryUrl: string
  /** Rights overview grounded in matched open sources */
  rights: RightsSummary
  /** Snippets used to build / refine the rights summary */
  sourceSnippets: SourceSnippet[]
  /** Interactive open tools (e.g. CAB decision trees) matched to the story */
  featuredTools: { id: string; title: string; detail: string; url: string }[]
  steps: OslawCourseStep[]
  related: { title: string; url: string; kind: string }[]
  disclaimer: string
}

export interface WikiCatalogue {
  collection: string
  pattern: string
  trialDomain: string
  domainId?: string
  wikiRoot: string
  compiledAt: string
  articleCount: number
  pageCount: number
  pages: WikiPage[]
}

export interface BriefSource {
  title: string
  url_or_id: string
  jurisdiction: string
  snippet: string
}

const AUTHORITY_BOOST: Record<string, number> = {
  primary: 4,
  secondary: 1,
  tertiary: -2,
}

/** Demote Visas/citizenship URLs when scoring non-immigration domain pages. */
const IMM_CITIZENSHIP_URL_NOISE =
  /immigration|visa|asylum|appendix-?fm|citizenship|british-citizen|leave-to-remain|suitability-section|deprivation-of-british|entry-clearance|cancellation-of-permission|indefinite-leave|settled-status/i

const DOMAIN_LOADERS: Record<WikiDomainId, () => Promise<{ default: WikiCatalogue }>> = {
  immigration: () =>
    import('@/data/coherence/immigrationWiki.json') as Promise<{ default: WikiCatalogue }>,
  housing: () => import('@/data/coherence/wikis/housingWiki.json') as Promise<{ default: WikiCatalogue }>,
  employment: () =>
    import('@/data/coherence/wikis/employmentWiki.json') as Promise<{ default: WikiCatalogue }>,
  debt: () => import('@/data/coherence/wikis/debtWiki.json') as Promise<{ default: WikiCatalogue }>,
  family: () => import('@/data/coherence/wikis/familyWiki.json') as Promise<{ default: WikiCatalogue }>,
  consumer: () =>
    import('@/data/coherence/wikis/consumerWiki.json') as Promise<{ default: WikiCatalogue }>,
  crime: () => import('@/data/coherence/wikis/crimeWiki.json') as Promise<{ default: WikiCatalogue }>,
}

const wikiCaches = new Map<WikiDomainId, WikiCatalogue>()

const FRAME_PREFIX_TO_DOMAIN: Record<string, WikiDomainId> = {
  'imm-': 'immigration',
  'hous-': 'housing',
  'emp-': 'employment',
  'debt-': 'debt',
  'fam-': 'family',
  'cons-': 'consumer',
  'crime-': 'crime',
}

const MATTER_TO_DOMAIN: Partial<Record<MatterType, WikiDomainId>> = {
  immigration: 'immigration',
  housing: 'housing',
  employment: 'employment',
  debt: 'debt',
  family: 'family',
  consumer: 'consumer',
  crime: 'crime',
}

export async function loadWiki(domain: WikiDomainId = 'immigration'): Promise<WikiCatalogue> {
  const cached = wikiCaches.get(domain)
  if (cached) return cached
  const loader = DOMAIN_LOADERS[domain]
  const mod = await loader()
  const catalogue = mod.default as WikiCatalogue
  wikiCaches.set(domain, catalogue)
  return catalogue
}

/** Domains to query for this session / frame set. */
export function activeDomains(session: SessionState, frames: LegalFrame[] = []): WikiDomainId[] {
  const domains = new Set<WikiDomainId>()
  const matterDomain = MATTER_TO_DOMAIN[session.matterType]
  if (matterDomain) domains.add(matterDomain)

  for (const f of frames) {
    for (const [prefix, domain] of Object.entries(FRAME_PREFIX_TO_DOMAIN)) {
      if (f.id.startsWith(prefix)) domains.add(domain)
    }
  }

  const blob = session.rawInputs.join(' ').toLowerCase()
  if (/\bilr\b|visa|asylum|home office|deport/.test(blob)) domains.add('immigration')
  if (/landlord|tenant|evict|mould|homeless|\brents?\b|tenancy|section\s*21/.test(blob)) domains.add('housing')
  if (/employer|dismiss|fired|redundan|wages/.test(blob)) domains.add('employment')
  if (/debt|bailiff|ccj|creditor/.test(blob)) domains.add('debt')
  if (/divorce|custody|child arrangement|domestic abuse/.test(blob)) domains.add('family')
  if (/refund|faulty|trader|warranty|consumer|\bcar\b|dealer|garage|fault codes?/.test(blob)) domains.add('consumer')
  if (/sentenc|arrest|police|criminal|offence|magistrates|cps|fraud|theft|assault/.test(blob))
    domains.add('crime')

  if (domains.size === 0) return []
  return [...domains]
}

function sessionText(session: SessionState): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => e.label),
    ...session.documents,
    session.matterType,
  ]
    .join(' ')
    .toLowerCase()
}

/** Hard filter: UK-wide pages always ok; nation-tagged pages only for matching session. */
export function jurisdictionAllows(pageJurisdiction: string, sessionJurisdiction: Jurisdiction): boolean {
  const pj = pageJurisdiction || 'UK'
  if (pj === 'UK' || pj === 'UK-wide' || pj === 'Unknown') return true
  if (sessionJurisdiction === 'Unknown') return true
  return pj === sessionJurisdiction
}

function scorePage(page: WikiPage, text: string, frameIds: string[], domainId?: WikiDomainId): number {
  let score = 0
  if (page.id.includes('sentinel')) return -1000

  const overlap = page.frameIds.filter((f) => frameIds.includes(f))
  score += overlap.length * 12
  if (page.kind === 'pathway' && overlap.length) score += 10
  if (page.kind === 'entity' && overlap.length) score += 6
  // Prefer concrete pathways over folder-dump topics (e.g. "work", "debt")
  if (page.kind === 'topic' && /^(work|employment|law|debt|benefits|money|housing|family)$/i.test(page.title.trim())) {
    score -= 8
  }

  score += AUTHORITY_BOOST[page.authority || 'secondary'] || 0

  if (
    domainId &&
    domainId !== 'immigration' &&
    IMM_CITIZENSHIP_URL_NOISE.test(page.primaryUrl || '')
  ) {
    score -= 40
  }

  for (const kw of page.keywords) {
    if (kw.length < 3) continue
    if (text.includes(kw)) score += kw.length > 5 ? 2 : 1
  }
  for (const sid of page.sourceIds) {
    if (
      text.includes(sid.replace(/-/g, ' ')) ||
      sid.split('-').some((w) => w.length > 4 && text.includes(w))
    ) {
      score += 2
    }
  }

  // Domain-agnostic story boosts
  if (/refus|reject|appeal|review|tribunal/.test(text) && /challenge|review|tribunal|appeal/.test(page.id + page.title.toLowerCase())) {
    score += 5
  }
  if (/evict|possession|section 21|lock.?out/.test(text) && /evict|possession|section/.test(page.id + page.title.toLowerCase())) {
    score += 5
  }
  // Shared housing must not collapse into deposit / rent-arrears / disrepair / homelessness pathways
  if (
    /flatmate|housemate|lodger|subtenant|excluded occupier|share[d]?\s+accommodation|joint tenancy|notice to quit/.test(
      text,
    )
  ) {
    const idTitle = `${page.id} ${page.title}`.toLowerCase()
    if (/shared|flatmate|lodger|housemate|accommodation|occupier|joint/.test(idTitle)) score += 18
    if (/deposit-rent|rent.?arrears|deposit.?protection/.test(idTitle)) score -= 16
    if (/disrepair|pathway-disrepair/.test(idTitle) && !/disrepair|mould|mold|damp|\brepairs?\b|leaking/.test(text)) {
      score -= 20
    }
    if (/homeless|pathway-homeless/.test(idTitle) && !/homeless|sofa|rough sleep|nowhere to stay/.test(text)) {
      score -= 22
    }
  }
  // Bare "repair" substring in pathway match caused false disrepair hits — require real conditions language
  if (
    /pathway-disrepair|disrepair \/ conditions/.test(`${page.id} ${page.title}`.toLowerCase()) &&
    !/disrepair|mould|mold|damp|\brepairs?\b|heating|leaking|hazard/.test(text)
  ) {
    score -= 14
  }
  if (
    /pathway-homelessness|homelessness/.test(`${page.id} ${page.title}`.toLowerCase()) &&
    !/homeless|sofa|rough sleep|nowhere to stay|priority need/.test(text)
  ) {
    score -= 14
  }
  if (/dismiss|fired|redundan/.test(text) && /dismiss|redundan|unfair/.test(page.id + page.title.toLowerCase())) {
    score += 5
  }
  if (/bailiff|ccj|debt/.test(text) && /bailiff|ccj|debt|enforcement/.test(page.id + page.title.toLowerCase())) {
    score += 5
  }
  if (/refund|faulty|consumer/.test(text) && /refund|faulty|consumer|trader/.test(page.id + page.title.toLowerCase())) {
    score += 4
  }
  if (/\bilr\b|indefinite leave|settlement|settled/.test(text) && /settlement|ilr|indefinite|settled/.test(page.id)) {
    score += 6
  }
  if (/asylum|refugee|scared to go back|protect/.test(text) && /asylum|protect|refugee/.test(page.id + page.title.toLowerCase())) {
    score += 6
  }
  if (/adviser|solicitor|regulated|near me/.test(text) && /adviser|solicitor/.test(page.id)) score += 5

  return score
}

function toHit(page: WikiPage, score: number, domainId: WikiDomainId): WikiHit {
  return {
    id: page.id,
    kind: page.kind,
    title: page.title,
    topic: page.kind,
    description: page.snippet,
    sourceUrl: page.primaryUrl,
    score,
    frameIds: page.frameIds,
    jurisdiction: page.jurisdiction,
    contradictions: page.contradictions,
    sourceIds: page.sourceIds,
    sourceUrls: page.sourceUrls,
    domainId,
    authority: page.authority,
  }
}

async function scoreDomain(
  domain: WikiDomainId,
  session: SessionState,
  frameIds: string[],
): Promise<{ page: WikiPage; score: number; domainId: WikiDomainId }[]> {
  const catalogue = await loadWiki(domain)
  const text = sessionText(session)
  return catalogue.pages
    .filter((p) => p.kind !== 'index')
    .filter((p) => jurisdictionAllows(p.jurisdiction, session.jurisdiction))
    .map((p) => ({ page: p, score: scorePage(p, text, frameIds, domain), domainId: domain }))
    .filter((x) => x.score > 0 && x.page.primaryUrl)
}

/**
 * Per-frame wiki lookup across active domains.
 */
export async function matchWikiForFrames(
  session: SessionState,
  frames: LegalFrame[],
  limit = 6,
): Promise<WikiHit[]> {
  const domains = activeDomains(session, frames)
  if (domains.length === 0) return []

  const frameIds = frames.length
    ? frames.map((f) => f.id)
    : [`${domains[0] === 'immigration' ? 'imm' : domains[0].slice(0, 4)}-general`]

  const scoredArrays = await Promise.all(domains.map((d) => scoreDomain(d, session, frameIds)))
  const scored = scoredArrays.flat().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aw = AUTHORITY_BOOST[a.page.authority || 'secondary'] || 0
    const bw = AUTHORITY_BOOST[b.page.authority || 'secondary'] || 0
    return bw - aw
  })

  const hits: WikiHit[] = []
  const seen = new Set<string>()

  for (const fid of frameIds) {
    const row = scored.find(
      (x) => x.page.frameIds.includes(fid) && !seen.has(x.page.id) && !x.page.id.includes('sentinel'),
    )
    if (row) {
      seen.add(row.page.id)
      hits.push(toHit(row.page, row.score, row.domainId))
    }
    if (hits.length >= limit) break
  }

  for (const row of scored) {
    if (hits.length >= limit) break
    if (seen.has(row.page.id) || row.page.id.includes('sentinel')) continue
    seen.add(row.page.id)
    hits.push(toHit(row.page, row.score, row.domainId))
  }

  return hits
}

/**
 * OSLAW research: match a pathway, rank its linked sources against the story,
 * then emit a practical course of action from the pathway playbook.
 * Not legal advice.
 */
export async function matchOslawCourse(
  session: SessionState,
  frames: LegalFrame[],
  limit = 3,
): Promise<OslawCourse | null> {
  const domains = activeDomains(session, frames)
  if (domains.length === 0) return null

  const frameIds = frames.length
    ? frames.map((f) => f.id)
    : [`${domains[0] === 'immigration' ? 'imm' : domains[0].slice(0, 4)}-general`]

  const text = sessionText(session)
  const scoredArrays = await Promise.all(domains.map((d) => scoreDomain(d, session, frameIds)))
  const scored = scoredArrays
    .flat()
    .map((row) => ({
      ...row,
      score: row.score + (row.page.kind === 'pathway' ? 18 : row.page.kind === 'topic' ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)

  const pathways = scored.filter((x) => x.page.kind === 'pathway' && x.page.primaryUrl)
  const primary = pathways[0] ?? scored.find((x) => x.page.primaryUrl)
  if (!primary) return null

  const page = primary.page
  const domainId = primary.domainId
  const catalogue = await loadWiki(domainId)
  const rankedSources = rankPathwaySources(page, text)
  const topics = linkedTopicPages(page, catalogue)
  const steps = synthesizeStepsFromWiki(page, catalogue, session, rankedSources)
  const featuredTools = featuredToolsFromWiki(page, catalogue, session, domainId)

  const snippetUrls = [
    ...featuredTools.map((t) => t.url),
    ...topics.map((t) => t.primaryUrl),
    ...rankedSources.map((s) => s.url),
  ]
  const sourceSnippets = await loadSourceSnippets(snippetUrls, 6)

  const rights = page.oslawRightsOverview
    ? buildRightsFromWiki(page, topics, sourceSnippets)
    : buildHeuristicRightsSummary(page.id, sourceSnippets)

  // Ensure at least one linked step uses the pathway primary
  if (!steps.some((s) => s.url === page.primaryUrl) && page.primaryUrl) {
    const rightsish = steps.find((s) => /rights|orient|lead|check/i.test(s.id + s.label))
    if (rightsish && !rightsish.url) {
      rightsish.url = page.primaryUrl
      rightsish.sourceTitle = titleFromUrl(page.primaryUrl)
    }
  }

  const related = [
    ...scored.filter((x) => x.page.kind === 'topic' && x.page.primaryUrl && /letter|complain|repair|refund|car|deposit|notice/i.test(x.page.title + x.page.id)),
    ...scored.filter((x) => x.page.kind === 'pathway' && x.page.id !== page.id && x.page.primaryUrl),
  ]
    .filter((x, i, arr) => arr.findIndex((y) => y.page.id === x.page.id) === i)
    .slice(0, limit)
    .map((x) => ({
      title: x.page.title,
      url: x.page.primaryUrl,
      kind: x.page.kind,
    }))

  return {
    pathwayId: page.id,
    title: page.title,
    summary: page.snippet || page.title,
    domainId: primary.domainId,
    authority: page.authority,
    primaryUrl: page.primaryUrl,
    rights,
    sourceSnippets,
    featuredTools,
    steps,
    related,
    disclaimer:
      'OSLAW surfaces open / official wiki pathways only. It is not legal advice and does not replace a regulated adviser.',
  }
}

type RankedSource = { url: string; title: string; score: number }

function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    const slug = path.split('/').filter(Boolean).pop() || 'Open guidance'
    const cleaned = slug.replace(/-/g, ' ').replace(/\.(html?|php)$/i, '')
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  } catch {
    return 'Open guidance'
  }
}

function rankPathwaySources(page: WikiPage, text: string): RankedSource[] {
  const urls = [...new Set([page.primaryUrl, ...(page.sourceUrls || [])].filter(Boolean))]
  const noise = /energy|boiler|insulation|meter|solid-wall|citizenship|visa|passport/i
  const storyBoosts: [RegExp, number][] = [
    [/\bcar\b|vehicle|dealer|garage|mot\b|battery|fault codes?/i, 8],
    [/warrant|guarante/i, 5],
    [/refund|cancel|money back/i, 5],
    [/landlord|tenant|mould|evict|deposit|homeless/i, 5],
    [/dismiss|employer|wages|acas|tribunal/i, 5],
  ]

  return urls
    .map((url) => {
      const blob = `${url} ${titleFromUrl(url)}`.toLowerCase()
      let score = 1
      if (url === page.primaryUrl) score += 2
      for (const [re, boost] of storyBoosts) {
        if (re.test(text) && re.test(blob)) score += boost
      }
      // Token overlap between story and URL slug
      for (const tok of text.split(/[^a-z0-9]+/).filter((t) => t.length > 3)) {
        if (blob.includes(tok)) score += 1
      }
      if (noise.test(blob) && !noise.test(text)) score -= 12
      return { url, title: titleFromUrl(url), score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** Legacy-compatible name. */
export async function matchImmigrationWiki(
  session: SessionState,
  frames: LegalFrame[],
  limit = 6,
): Promise<WikiHit[]> {
  return matchWikiForFrames(session, frames, limit)
}

export function wikiHitsToBriefSources(hits: WikiHit[]): BriefSource[] {
  // Prefer primary authority when ordering citations
  const ordered = [...hits].sort((a, b) => {
    const aw = AUTHORITY_BOOST[a.authority || 'secondary'] || 0
    const bw = AUTHORITY_BOOST[b.authority || 'secondary'] || 0
    return bw - aw
  })
  return ordered.map((h) => ({
    title: h.title,
    url_or_id: h.sourceUrl || h.sourceIds[0] || h.id,
    jurisdiction: h.jurisdiction,
    snippet: h.description.slice(0, 200),
  }))
}

export function wikiHitsToSignposts(
  hits: WikiHit[],
): { label: string; type: 'info' | 'clinic' | 'solicitor' | 'emergency'; url: string }[] {
  return hits
    .filter((h) => h.sourceUrl)
    .map((h) => ({
      label: h.title,
      type: /adviser|solicitor/.test(h.id + h.title.toLowerCase()) ? ('solicitor' as const) : ('info' as const),
      url: h.sourceUrl,
    }))
}

/** Assign sources onto each frame for solicitor brief issues. */
export async function sourcesByFrame(
  session: SessionState,
  frames: LegalFrame[],
  perFrame = 3,
): Promise<Record<string, BriefSource[]>> {
  const domains = activeDomains(session, frames)
  const text = sessionText(session)
  const out: Record<string, BriefSource[]> = {}

  const catalogues = await Promise.all(domains.map((d) => loadWiki(d)))
  const pages = catalogues.flatMap((c, i) =>
    c.pages.map((p) => ({ page: p, domainId: domains[i] })),
  )

  for (const frame of frames) {
    const scored = pages
      .filter(({ page: p }) => p.kind !== 'index')
      .filter(({ page: p }) => jurisdictionAllows(p.jurisdiction, session.jurisdiction))
      .filter(({ page: p }) => !p.id.includes('sentinel'))
      .map(({ page: p, domainId }) => ({
        page: p,
        score: scorePage(p, text, [frame.id], domainId),
      }))
      .filter((x) => x.score > 0 && x.page.primaryUrl)
      .sort((a, b) => b.score - a.score)
      .slice(0, perFrame)

    out[frame.id] = scored.map((x) => ({
      title: x.page.title,
      url_or_id: x.page.primaryUrl || x.page.sourceIds[0] || x.page.id,
      jurisdiction: x.page.jurisdiction,
      snippet: x.page.snippet.slice(0, 200),
    }))
  }
  return out
}

export async function wikiInfo(domain: WikiDomainId = 'immigration') {
  const catalogue = await loadWiki(domain)
  return {
    name: catalogue.collection,
    domainId: (catalogue.domainId || domain) as WikiDomainId,
    pageCount: catalogue.pageCount,
    articleCount: catalogue.articleCount,
    compiledAt: catalogue.compiledAt,
    pattern: catalogue.pattern,
  }
}

export async function wikiInfoForSession(session: SessionState, frames: LegalFrame[] = []) {
  const domains = activeDomains(session, frames)
  const infos = await Promise.all(domains.map((d) => wikiInfo(d)))
  const articleCount = infos.reduce((n, i) => n + i.articleCount, 0)
  const pageCount = infos.reduce((n, i) => n + i.pageCount, 0)
  return {
    name: infos.map((i) => i.name).join(' + '),
    domains,
    articleCount,
    pageCount,
    compiledAt: infos[0]?.compiledAt,
    pattern: 'llm-wiki-domain',
  }
}
