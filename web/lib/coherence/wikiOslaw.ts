/**
 * Query-time OSLAW synthesis from compiled wiki pathway + linked topic/tool pages.
 * Karpathy pattern: read persistent wiki markdown/JSON at query time, not static playbooks.
 */
import type { SessionState } from './types'
import type { RightsSummary } from './oslawRights'
import { RIGHTS_CAVEAT } from './oslawRights'
import { OSLAW_GENERIC_PLAYBOOK, OSLAW_PLAYBOOKS } from './oslawPlaybooks'
import type { SourceSnippet } from './oslawSummary'
import type { OslawCourseStep, WikiCatalogue, WikiDomainId, WikiPage } from './wiki'
import { tidySentence } from './timelineExtract'
import { buildRetrievalText } from './retrievalText'

export type OslawRightsBullet = {
  text: string
  sourceTitle?: string
  sourceUrl?: string
}

export type OslawCompiledStep = {
  id: string
  label: string
  detail: string
  sourceUrl?: string
  sourceTitle?: string
  toolId?: string
  /** Regex source string from compile-time step filter */
  when?: string
}

export type WikiToolPage = WikiPage & {
  kind: 'tool'
  toolMeta?: {
    url: string
    detail: string
    when?: string
    provider?: string
    pathwayIds?: string[]
  }
}

function sessionText(session: SessionState): string {
  return buildRetrievalText(session)
}

/** Private parking / PCN stories — must not trigger used-car tools (\bcar\b matches "car park"). */
export function isPrivateParkingStory(text: string): boolean {
  return /\b(parking|car\s*park|pcn|popla|private parking|parking charge|parking fine|parking ticket|parking app|parking company)\b/i.test(
    text,
  )
}

export function isUsedCarPurchaseStory(text: string): boolean {
  const purchase =
    /\b(used car|bought .{0,24}(?:car|vehicle)|dealer|garage|mot\b|fault codes?|motor vehicle)\b/i.test(
      text,
    )
  if (isPrivateParkingStory(text) && !purchase) return false
  return purchase
}

function looksLikeUsedCarWhen(when: string): boolean {
  return /\\bcar\\b|used car|vehicle|dealer|garage|mot\\b|fault codes?|motor/i.test(when)
}

function stepMatchesWhen(when: string | undefined, text: string): boolean {
  if (!when) return true
  try {
    if (!new RegExp(when, 'is').test(text)) return false
    // Guard: parking stories must not activate used-car step filters
    if (
      isPrivateParkingStory(text) &&
      !isUsedCarPurchaseStory(text) &&
      looksLikeUsedCarWhen(when)
    ) {
      return false
    }
    return true
  } catch {
    return true
  }
}

function pageById(catalogue: WikiCatalogue, id: string): WikiPage | undefined {
  return catalogue.pages.find((p) => p.id === id)
}

function toolPages(catalogue: WikiCatalogue): WikiToolPage[] {
  return catalogue.pages.filter((p): p is WikiToolPage => p.kind === 'tool')
}

/**
 * Build rights summary from compiled pathway OSLAW fields + linked topic snippets.
 */
export function buildRightsFromWiki(
  page: WikiPage,
  topicPages: WikiPage[],
  snippets: SourceSnippet[],
): RightsSummary {
  const overview =
    page.oslawRightsOverview ||
    page.snippet ||
    'Open UK guidance for this pathway describes common rights and remedies — check the linked sources for specifics.'

  const bullets: OslawRightsBullet[] = []

  if (page.oslawRightsBullets?.length) {
    for (const b of page.oslawRightsBullets) {
      bullets.push({
        text: b.text,
        sourceTitle: b.sourceTitle,
        sourceUrl: b.sourceUrl,
      })
    }
  }

  // Elaborate from linked topic pages when they add distinct cited lines
  for (const topic of topicPages.slice(0, 2)) {
    if (!topic.snippet) continue
    const line = topic.snippet.split(/[.!?]/).find((p) => p.trim().length > 40)
    if (!line) continue
    if (bullets.some((b) => b.text.includes(line.slice(0, 30)))) continue
    bullets.push({
      text: tidySentence(line),
      sourceTitle: topic.title,
      sourceUrl: topic.primaryUrl,
    })
  }

  // Attach catalogue snippets as cited elaborations
  for (const s of snippets.slice(0, 3)) {
    if (bullets.some((b) => b.sourceUrl === s.url)) continue
    const line = s.preview.split(/[.!?]/).find((p) => p.trim().length > 40)
    if (!line) continue
    bullets.push({
      text: tidySentence(line),
      sourceTitle: s.title,
      sourceUrl: s.url,
    })
  }

  return {
    overview,
    bullets: bullets.slice(0, 7).map((b) => ({
      text: b.text,
      sourceTitle: b.sourceTitle,
      sourceUrl: b.sourceUrl,
    })),
    origin: page.oslawOrigin === 'llm' ? 'llm' : 'wiki',
    caveat: RIGHTS_CAVEAT,
  }
}

type RankedSource = { url: string; title: string; score: number }

/**
 * Synthesize practical steps from compiled pathway OSLAW steps, resolving tool/topic citations.
 */
export function synthesizeStepsFromWiki(
  page: WikiPage,
  catalogue: WikiCatalogue,
  session: SessionState,
  rankedSources: RankedSource[],
): OslawCourseStep[] {
  const text = sessionText(session)
  const tools = toolPages(catalogue)
  const compiled = page.oslawSteps

  if (compiled?.length) {
    const usedUrls = new Set<string>()
    const out: OslawCourseStep[] = []

    for (const def of compiled) {
      if (!stepMatchesWhen(def.when, text)) continue

      let url = def.sourceUrl
      let sourceTitle = def.sourceTitle

      if (def.toolId) {
        const tool = tools.find((t) => t.id === def.toolId)
        if (tool) {
          url = tool.toolMeta?.url || tool.primaryUrl
          sourceTitle = tool.title
        }
      }

      if (url) usedUrls.add(url)

      out.push({
        id: def.id,
        label: def.label,
        detail: def.detail,
        url,
        sourceTitle,
      })
      if (out.length >= 8) break
    }

    if (out.length) return out
  }

  // Fallback: legacy static playbooks (pre-enriched wikis)
  return synthesizeFromPlaybook(page, text, rankedSources)
}

function synthesizeFromPlaybook(
  page: WikiPage,
  text: string,
  rankedSources: RankedSource[],
): OslawCourseStep[] {
  const playbook = OSLAW_PLAYBOOKS[page.id] ?? OSLAW_GENERIC_PLAYBOOK
  const usedUrls = new Set<string>()
  const steps: OslawCourseStep[] = []

  for (const def of playbook) {
    if (def.when && !def.when.test(text)) continue
    if (
      isPrivateParkingStory(text) &&
      !isUsedCarPurchaseStory(text) &&
      def.when &&
      looksLikeUsedCarWhen(def.when.source)
    ) {
      continue
    }

    let pick: RankedSource | undefined
    if (def.fixedUrl) {
      pick = {
        url: def.fixedUrl,
        title: def.fixedTitle || titleFromUrl(def.fixedUrl),
        score: 100,
      }
    } else if (def.prefer) {
      pick = pickSource(rankedSources, def.prefer, def.avoid, usedUrls)
    }
    if (!pick && !def.prefer && !def.fixedUrl && steps.length === 0 && page.primaryUrl) {
      pick = { url: page.primaryUrl, title: titleFromUrl(page.primaryUrl), score: 0 }
    }
    if (pick) usedUrls.add(pick.url)

    steps.push({
      id: def.id,
      label: def.label,
      detail: def.detail,
      url: pick?.url,
      sourceTitle: pick?.title,
    })
    if (steps.length >= 8) break
  }

  return steps
}

/**
 * Featured tools from compiled wiki tool entities linked to the pathway.
 */
export function featuredToolsFromWiki(
  page: WikiPage,
  catalogue: WikiCatalogue,
  session: SessionState,
  domainId?: WikiDomainId,
): { id: string; title: string; detail: string; url: string }[] {
  const text = sessionText(session)
  const toolIds = new Set(page.oslawToolIds || [])
  const tools = toolPages(catalogue).filter((t) => toolIds.has(t.id))

  const matched = tools
    .filter((t) => {
      const when = t.toolMeta?.when
      if (!when) return true
      try {
        if (!new RegExp(when, 'i').test(text)) return false
        if (
          isPrivateParkingStory(text) &&
          !isUsedCarPurchaseStory(text) &&
          looksLikeUsedCarWhen(when)
        ) {
          return false
        }
        return true
      } catch {
        return true
      }
    })
    .map((t) => ({
      id: t.id,
      title: t.title,
      detail: t.toolMeta?.detail || t.snippet,
      url: t.toolMeta?.url || t.primaryUrl,
    }))

  if (matched.length) return matched.slice(0, 3)

  // Pathway-linked tools by pathwayIds on tool meta
  const byPathway = toolPages(catalogue)
    .filter((t) => t.toolMeta?.pathwayIds?.includes(page.id))
    .filter((t) => {
      const when = t.toolMeta?.when
      if (!when) return true
      try {
        if (!new RegExp(when, 'i').test(text)) return false
        if (
          isPrivateParkingStory(text) &&
          !isUsedCarPurchaseStory(text) &&
          looksLikeUsedCarWhen(when)
        ) {
          return false
        }
        return true
      } catch {
        return true
      }
    })
    .map((t) => ({
      id: t.id,
      title: t.title,
      detail: t.toolMeta?.detail || t.snippet,
      url: t.toolMeta?.url || t.primaryUrl,
    }))

  if (byPathway.length) return byPathway.slice(0, 3)

  void domainId
  return []
}

/** Linked topic pages referenced from the pathway compile. */
export function linkedTopicPages(page: WikiPage, catalogue: WikiCatalogue): WikiPage[] {
  const ids = page.linkedTopicIds || []
  if (!ids.length) {
    // Frame overlap fallback
    return catalogue.pages.filter(
      (p) =>
        p.kind === 'topic' &&
        p.primaryUrl &&
        p.frameIds?.some((fid) => page.frameIds.includes(fid)),
    )
  }
  return ids.map((id) => pageById(catalogue, id)).filter((p): p is WikiPage => Boolean(p))
}

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

function pickSource(
  ranked: RankedSource[],
  prefer: RegExp | undefined,
  avoid: RegExp | undefined,
  used: Set<string>,
): RankedSource | undefined {
  const pool = ranked.filter((s) => !used.has(s.url))
  if (prefer) {
    const hit = pool.find((s) => prefer.test(s.url) && !(avoid && avoid.test(s.url)))
    if (hit) return hit
  }
  return pool.find((s) => !(avoid && avoid.test(s.url))) ?? pool[0]
}
