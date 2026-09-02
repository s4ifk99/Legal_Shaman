import type { MatterType, SearchMode } from './types'

export type ResearchSource = {
  id: string
  title: string
  url: string
  tier: 'official' | 'primary-law' | 'trusted-guidance' | 'secondary' | 'wiki'
  excerpt: string
  origin: 'curated' | 'external'
  verified: boolean
}

export type ResearchClaim = {
  claim: string
  sourceIds: string[]
  confidence: 'high' | 'medium' | 'low'
}

export type MatchingGuidance = {
  matterType: MatterType
  topicId: string
  taxonomySlug?: string
  confidence: 'high' | 'medium' | 'low'
  rationale: string
  sourceIds: string[]
}

export type FreeResourceCandidate = {
  id: string
  title: string
  description: string
  url: string
  resourceType: 'charity' | 'helpline' | 'clinic' | 'ombudsman' | 'government' | 'directory' | 'other' | 'solicitor' | 'law-centre' | 'legal-aid'
  costBand?: 'free' | 'paid'
  matterType: MatterType
  topicId: string
  phone?: string
  sourceIds: string[]
  reviewStatus: 'pending_review'
}

export type ResearchBundle = {
  mode: SearchMode
  status: 'needs_input' | 'complete'
  questions: string[]
  sources: ResearchSource[]
  claims: ResearchClaim[]
  conflicts: string[]
  missingFacts: string[]
  nextActions: string[]
  answerDraft?: string
  matching?: MatchingGuidance
  freeResources: FreeResourceCandidate[]
}

export function emptyResearchBundle(mode: SearchMode): ResearchBundle {
  return {
    mode,
    status: 'complete',
    questions: [],
    sources: [],
    claims: [],
    conflicts: [],
    missingFacts: [],
    nextActions: [],
    freeResources: [],
  }
}

function list(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, max)
    : []
}

export function parseResearchBundle(
  raw: string,
  mode: SearchMode,
  allowedSourceIds?: ReadonlySet<string>,
): ResearchBundle | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object') return null
  const value = parsed as Record<string, unknown>
  const sources = Array.isArray(value.sources)
    ? value.sources
        .map((source, index) => {
          const item = source && typeof source === 'object' ? (source as Record<string, unknown>) : {}
          const title = String(item.title || '').trim().slice(0, 240)
          const excerpt = String(item.excerpt || item.snippet || '').trim()
          if (!title || !excerpt) return null
          const id = String(item.id || `aramb-source-${index + 1}`).trim()
          const url = String(item.url || '').trim().slice(0, 2000)
          const isCurated = !allowedSourceIds || allowedSourceIds.has(id)
          const isExternal =
            !isCurated &&
            /^(?:web|external)-[a-z0-9][a-z0-9._-]{2,100}$/i.test(id) &&
            /^https:\/\//i.test(url)
          if (!isCurated && !isExternal) return null
          return {
            id: id.slice(0, 120),
            title,
            url,
            tier: ['official', 'primary-law', 'trusted-guidance', 'secondary', 'wiki'].includes(
              String(item.tier),
            )
              ? (String(item.tier) as ResearchSource['tier'])
              : 'secondary',
            excerpt: excerpt.slice(0, 900),
            origin: isExternal ? 'external' : 'curated',
            verified: !isExternal,
          }
        })
        .filter((source): source is ResearchSource => Boolean(source))
        .slice(0, 20)
    : []

  const sourceIds = new Set(sources.map((source) => source.id))
  const claims = Array.isArray(value.claims)
    ? value.claims
        .map((claim) => {
          const item = claim && typeof claim === 'object' ? (claim as Record<string, unknown>) : {}
          const text = String(item.claim || '').trim()
          const ids = list(item.sourceIds, 5).filter((id) => sourceIds.has(id))
          if (!text || ids.length === 0) return null
          const confidence = ['high', 'medium', 'low'].includes(String(item.confidence))
            ? (String(item.confidence) as ResearchClaim['confidence'])
            : 'low'
          return { claim: text.slice(0, 500), sourceIds: ids, confidence }
        })
        .filter((claim): claim is ResearchClaim => Boolean(claim))
        .slice(0, 20)
    : []

  const rawMatching = value.matching && typeof value.matching === 'object'
    ? (value.matching as Record<string, unknown>)
    : null
  const matchingType = String(rawMatching?.matterType || '')
  const matchingIds = rawMatching ? list(rawMatching.sourceIds, 5).filter((id) => sourceIds.has(id)) : []
  const matching =
    rawMatching &&
    ['immigration', 'personal_injury', 'housing', 'conveyancing', 'employment', 'family', 'debt', 'consumer', 'crime', 'other', 'unknown'].includes(matchingType) &&
    matchingIds.length > 0 &&
    String(rawMatching.rationale || '').trim()
      ? {
          matterType: matchingType as MatterType,
          topicId: String(rawMatching.topicId || 'general').trim().slice(0, 100),
          taxonomySlug: String(rawMatching.taxonomySlug || '').trim().slice(0, 100) || undefined,
          confidence: ['high', 'medium', 'low'].includes(String(rawMatching.confidence))
            ? (String(rawMatching.confidence) as MatchingGuidance['confidence'])
            : 'low',
          rationale: String(rawMatching.rationale).replace(/\s+/g, ' ').trim().slice(0, 500),
          sourceIds: matchingIds,
        }
      : undefined
  const validMatterTypes = [
    'immigration',
    'personal_injury',
    'housing',
    'conveyancing',
    'employment',
    'family',
    'debt',
    'consumer',
    'crime',
    'other',
    'unknown',
  ]
  const validResourceTypes = [
    'charity',
    'helpline',
    'clinic',
    'ombudsman',
    'government',
    'directory',
    'other',
    'solicitor',
    'law-centre',
    'legal-aid',
  ]
  const freeResources = Array.isArray(value.freeResources)
    ? value.freeResources
        .map((resource, index) => {
          const item = resource && typeof resource === 'object' ? (resource as Record<string, unknown>) : {}
          const title = String(item.title || '').replace(/\s+/g, ' ').trim().slice(0, 240)
          const description = String(item.description || item.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 500)
          const url = String(item.url || '').trim().slice(0, 2000)
          const ids = list(item.sourceIds, 5).filter((id) => sourceIds.has(id))
          const matterType = String(item.matterType || '')
          if (
            !title ||
            !description ||
            !/^https:\/\//i.test(url) ||
            !validMatterTypes.includes(matterType) ||
            !validResourceTypes.includes(String(item.resourceType))
          ) {
            return null
          }
          return {
            id: String(item.id || `aramb-resource-${index + 1}`).slice(0, 120),
            title,
            description,
            url,
            resourceType: String(item.resourceType) as FreeResourceCandidate['resourceType'],
            costBand: String(item.costBand || '') === 'paid' ? ('paid' as const) : ('free' as const),
            matterType: matterType as MatterType,
            topicId: String(item.topicId || 'general').replace(/\s+/g, '-').slice(0, 100),
            phone: String(item.phone || '').trim().slice(0, 40) || undefined,
            sourceIds: ids.length ? ids : [],
            reviewStatus: 'pending_review' as const,
          }
        })
        .filter((resource): resource is FreeResourceCandidate => Boolean(resource))
        .slice(0, 12)
    : []

  return {
    mode,
    status: value.status === 'needs_input' ? 'needs_input' : 'complete',
    questions: list(value.questions, 3),
    sources,
    claims,
    conflicts: list(value.conflicts, 8),
    missingFacts: list(value.missingFacts, 8),
    nextActions: list(value.nextActions, 8),
    answerDraft: String(value.answerDraft || '').trim().slice(0, 4000) || undefined,
    matching,
    freeResources,
  }
}

export function canonicalizeResearchBundle(
  bundle: ResearchBundle,
  canonicalSources: ResearchSource[],
): ResearchBundle {
  const byId = new Map(canonicalSources.map((source) => [source.id, source]))
  const sources = bundle.sources
    .map((source) => {
      const canonical = byId.get(source.id)
      if (canonical) return { ...canonical, origin: 'curated' as const, verified: true }
      if (
        source.origin === 'external' &&
        /^(?:web|external)-[a-z0-9][a-z0-9._-]{2,100}$/i.test(source.id) &&
        /^https:\/\/[^\s/]+/i.test(source.url) &&
        source.title.length <= 240 &&
        source.excerpt.length <= 900
      ) {
        return { ...source, origin: 'external' as const, verified: false }
      }
      return null
    })
    .filter((source): source is ResearchSource => Boolean(source))
  const sourceIds = new Set(sources.map((source) => source.id))
  const claims = bundle.claims
    .map((claim) => ({ ...claim, sourceIds: claim.sourceIds.filter((id) => sourceIds.has(id)) }))
    .filter((claim) => claim.sourceIds.length > 0)
  const questions = bundle.questions.filter(Boolean).slice(0, 3)
  const matching =
    bundle.matching && bundle.matching.sourceIds.some((id) => sourceIds.has(id))
      ? { ...bundle.matching, sourceIds: bundle.matching.sourceIds.filter((id) => sourceIds.has(id)) }
      : undefined
  const freeResources = (bundle.freeResources || [])
    .map((resource) => ({
      ...resource,
      sourceIds: resource.sourceIds.filter((id) => sourceIds.has(id)),
    }))
    .filter((resource) => resource.url.startsWith('https://'))
  return {
    ...bundle,
    status: questions.length > 0 ? 'needs_input' : bundle.status,
    questions,
    sources,
    claims,
    matching,
    freeResources,
  }
}

export function researchBundlePrompt(opts: {
  mode: SearchMode
  query: string
  context: string
}): string {
  return [
    'Search mode: Penumbra (primary exploratory research)',
    'You are The Shaman, Legal Shaman’s Penumbra research assistant. Work in two phases: first analyse the supplied curated Legal Shaman sources; then, where they leave gaps, use every enabled web/search/browser capability for wide open-source legal research.',
    'Do not invent sources or legal rules. If web tools are unavailable, say so in missingFacts or nextActions instead of pretending that open-web research occurred.',
    'Return JSON only with status, questions, sources, claims, conflicts, missingFacts, nextActions, matching, freeResources and optional answerDraft.',
    'Set status to needs_input and ask up to 3 focused research questions when more user facts are needed; otherwise use complete and set questions to [].',
    'Keep curated source ids unchanged. Every external source id must start with web- or external-, include an https URL, title and excerpt. Every claim must cite one or more returned source ids.',
    'For each source return id, title, url, tier and excerpt; set origin to curated for supplied sources and external for open-web sources. Do not return a source without an excerpt.',
    'Always return matching: {matterType, topicId, taxonomySlug, confidence, rationale, sourceIds}. Choose one primary area only, cite the source ids supporting that routing choice, and never recommend a specific solicitor from open-web material. If the evidence is insufficient, use confidence low and say why.',
    'After the curated review, also find who can help: freeResources for charities, helplines, law centres, legal aid, and official solicitor directories (SRA / Law Society). Set costBand to free or paid. Do not return individual unsolicited law-firm marketing pages as recommendations. HTTPS URLs only; cite source ids when present.',
    'Label external material with its actual source quality and treat it as unverified research leads, not established law. Record conflicts rather than silently choosing between sources.',
    'Do not predict whether the client will win. Say when the supplied sources do not answer the question.',
    `Client research question:\n${opts.query.slice(0, 3500)}`,
    `Candidate sources:\n${opts.context.slice(0, 18000)}`,
  ].join('\n\n')
}
