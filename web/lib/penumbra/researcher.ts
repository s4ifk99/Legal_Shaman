import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import OpenAI from 'openai'

import { authorityTierForUrl } from '@/lib/coherence/authorityAllowlist'
import {
  canonicalizeResearchBundle,
  parseResearchBundle,
  researchBundlePrompt,
  type FreeResourceCandidate,
  type ResearchBundle,
  type ResearchSource,
} from '@/lib/coherence/researchBundle'
import type { SearchMode } from '@/lib/coherence/types'
import {
  openRouterDefaultHeaders,
  resolveChatModel,
  resolveLlmApiKey,
  resolveLlmBaseUrl,
} from '@/lib/llm/openrouter'
import {
  baseArambDiagnostic,
  logArambDiagnostic,
  type ArambResearchDiagnostic,
} from '@/lib/aramb/diagnostics'
import { searchExaForPenumbra, exaPenumbraConfigured } from '@/lib/penumbra/exaSearch'
import {
  mergeExaSearchHits,
  penumbraLiveExaEnabled,
  penumbraOfflineExaEnabled,
  searchOfflineExaIndexForPenumbra,
} from '@/lib/penumbra/offlineExaIndex'
import {
  buildPenumbraCacheKey,
  buildExaHitsCacheKey,
  getPenumbraResearchCache,
  getPenumbraExaHitsCache,
  putPenumbraResearchCache,
  putPenumbraExaHitsCache,
} from '@/lib/penumbra/researchCache'
import type { ExaResearchQuery } from '@/lib/penumbra/exaBrief'
import { groupBySlot, matchingSlotIds, primaryMatterSlug, type CoverageSlot } from '@/lib/matter/coverageSlots'
import { discoverHelpFromExaHits } from '@/lib/penumbra/helpDiscover'

export type PenumbraResearchInput = {
  mode: SearchMode
  query: string
  sourceContext: string
  canonicalSources: ResearchSource[]
  tenantKey: string
  conversationId?: string
  /** Matter slug from MatterEngine — part of shared cache key. */
  matterSlug?: string
  /** Skip cache read/write (e.g. admin replay). */
  skipCache?: boolean
  /** Full-power Exa queries (open web + official). */
  exaQueries?: ExaResearchQuery[]
  /** Frozen coverage slots — Exa hits must fill these. */
  coverageSlots?: CoverageSlot[]
  /** Original story for jurisdiction / slot matching. */
  story?: string
}

export type PenumbraResearchResult = {
  bundle: ResearchBundle
  conversationId: string
  tokens?: number
  latencyMs: number
  cacheHit?: boolean
  cacheKey?: string
  /** Where gap-fill sources came from: cache skip, offline index, live Exa, or hybrid. */
  exaSource?: 'offline' | 'live' | 'hybrid'
  offlineHitCount?: number
}

export type PenumbraResearchOutcome =
  | { ok: true; result: PenumbraResearchResult }
  | { ok: false; diagnostic: ArambResearchDiagnostic }

function tierForExaUrl(url: string): ResearchSource['tier'] {
  const authority = authorityTierForUrl(url)
  if (authority === 'primary') return 'primary-law'
  if (authority === 'secondary') return 'official'
  if (authority === 'tertiary') return 'trusted-guidance'
  if (authority === 'firm') return 'secondary'
  return 'secondary'
}

function exaHitsToSources(hits: Awaited<ReturnType<typeof searchExaForPenumbra>>['hits']): ResearchSource[] {
  const seen = new Set<string>()
  const sources: ResearchSource[] = []
  for (const hit of hits) {
    if (seen.has(hit.url)) continue
    seen.add(hit.url)
    sources.push({
      id: hit.id,
      title: hit.title,
      url: hit.url,
      tier: tierForExaUrl(hit.url),
      excerpt: hit.excerpt,
      origin: 'external',
      verified: false,
    })
  }
  return sources
}

function formatExaContext(sources: ResearchSource[]): string {
  if (!sources.length) return 'No additional open-web sources were returned by Exa.'
  return sources
    .map(
      (source, index) =>
        `${index + 1}. [${source.id}] ${source.title}\nURL: ${source.url}\nTier hint: ${source.tier}\nExcerpt: ${source.excerpt}`,
    )
    .join('\n\n')
}

function filterHitsBySlots(
  hits: Awaited<ReturnType<typeof searchExaForPenumbra>>['hits'],
  slots: CoverageSlot[],
  story: string,
) {
  if (!slots.length) return hits
  const good = hits.filter((hit) => matchingSlotIds(`${hit.title} ${hit.url} ${hit.excerpt}`, slots, story).length)
  return good.length ? good : hits.slice(0, 3)
}

function filterCanonicalBySlots(sources: ResearchSource[], slots: CoverageSlot[], story: string): ResearchSource[] {
  if (!slots.length) return sources
  const good = sources.filter((source) => matchingSlotIds(`${source.title} ${source.excerpt}`, slots, story).length)
  return good.length >= 2 ? good : sources
}

function memoFromExaSources(
  query: string,
  exaSources: ResearchSource[],
  canonicalSources: ResearchSource[],
  slots: CoverageSlot[] = [],
  story = '',
): string {
  const groups = groupBySlot(exaSources, slots, {
    story,
    extraText: (s) => `${s.url} ${s.excerpt}`,
  })
  const found =
    groups.length > 0
      ? groups.flatMap((g) => {
          const heading = g.slot ? g.slot.label : 'Other'
          return [
            `${heading}:`,
            ...g.items.slice(0, 4).map((s, i) => `${i + 1}. ${s.title} (${s.tier}, unverified)\n${s.url}\n${s.excerpt.slice(0, 280)}`),
          ]
        })
      : exaSources.slice(0, 10).map(
          (s, i) => `${i + 1}. ${s.title} (${s.tier}, unverified)\n${s.url}\n${s.excerpt.slice(0, 320)}`,
        )
  const lines = [
    'Third Eye filled gaps on the frozen issue graph. This is supplemental, not a second recommendation.',
    '',
    query.replace(/\s+/g, ' ').trim().slice(0, 280),
    '',
    'What Exa found (by issue):',
    ...found,
  ]
  if (canonicalSources.length) {
    lines.push('', 'Legal Shaman library already on file:', ...canonicalSources.slice(0, 4).map((s) => `- ${s.title}`))
  }
  return lines.join('\n')
}

function penumbraLlmSynthEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.PENUMBRA_LLM_SYNTH?.trim() || '')
}
function deterministicBundleFromSources(
  mode: SearchMode,
  query: string,
  canonicalSources: ResearchSource[],
  exaSources: ResearchSource[],
  slots: CoverageSlot[] = [],
  story = '',
): ResearchBundle | null {
  const sources = [...canonicalSources, ...exaSources]
  if (!sources.length) return null

  const claims = exaSources.slice(0, 6).map((source) => ({
    claim: source.excerpt.replace(/\s+/g, ' ').trim().slice(0, 400),
    sourceIds: [source.id],
    confidence: 'low' as const,
  }))

  const questionLead = query.replace(/\s+/g, ' ').trim().slice(0, 240)
  return {
    mode,
    status: 'complete',
    questions: [],
    sources,
    claims,
    conflicts: [],
    missingFacts: ['Exact dates, documents, contract wording, and the outcome you want.'],
    nextActions: [
      'Read the cited official guidance and compare it to your documents before you act.',
      'Ask Citizens Advice or a specialist helpline if the route or liability is unclear.',
    ],
    answerDraft: memoFromExaSources(query, exaSources, canonicalSources, slots, story),
    freeResources: [],
  }
}

function mergeHelpResources(
  existing: FreeResourceCandidate[],
  discovered: FreeResourceCandidate[],
): FreeResourceCandidate[] {
  const seen = new Set(existing.map((r) => r.url.replace(/\/+$/, '').toLowerCase()))
  const out = [...existing]
  for (const item of discovered) {
    const key = item.url.replace(/\/+$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= 12) break
  }
  return out
}

function fail(
  reason: ArambResearchDiagnostic['reason'],
  started: number,
  extra: Partial<ArambResearchDiagnostic> = {},
): PenumbraResearchOutcome {
  const diagnostic = baseArambDiagnostic(reason, Date.now() - started, {
    gatewayHost: 'api.exa.ai',
    agentIdSuffix: 'exa-penumbra',
    sdkVersion: 'exa-rest',
    ...extra,
  })
  logArambDiagnostic(diagnostic)
  return { ok: false, diagnostic }
}

function conversationIdFor(input: PenumbraResearchInput): string {
  const existing = input.conversationId?.trim()
  if (existing) return existing
  const digest = createHash('sha256').update(input.tenantKey).digest('hex').slice(0, 12)
  return `exa-${digest}-${randomUUID().slice(0, 8)}`
}

function resolvePenumbraModel(): string {
  const candidates = [
    process.env.PENUMBRA_LLM_MODEL,
    process.env.LLM_SMALL_MODEL,
    process.env.OPENROUTER_MODEL,
    process.env.LLM_CHAT_MODEL,
    process.env.LLM_MODEL,
  ]
  for (const raw of candidates) {
    const model = raw?.trim()
    if (!model || /^https?:\/\//i.test(model) || model.includes('/api/')) continue
    return model
  }
  return resolveChatModel()
}

async function synthesizeResearchBundle(prompt: string): Promise<string> {
  const apiKey = resolveLlmApiKey()
  if (!apiKey) throw new Error('LLM_API_KEY is not set')

  const client = new OpenAI({
    apiKey,
    baseURL: resolveLlmBaseUrl(),
    timeout: Number(process.env.PENUMBRA_LLM_TIMEOUT_MS || 40_000),
    maxRetries: 0,
    ...(openRouterDefaultHeaders() ? { defaultHeaders: openRouterDefaultHeaders() } : {}),
  })

  const response = await client.chat.completions.create({
    model: resolvePenumbraModel(),
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 2800,
    messages: [
      {
        role: 'system',
        content:
          'You are The Shaman, Legal Shaman Penumbra research assistant. Return valid JSON only matching the requested ResearchBundle shape.',
      },
      { role: 'user', content: prompt },
    ],
  })

  const content = response.choices[0]?.message?.content?.trim()
  if (!content) throw new Error('LLM synthesis returned empty content')
  return content
}

/**
 * Penumbra / Third Eye research: curated Legal Shaman sources first, offline Exa index,
 * optional live Exa gap-fill, then OpenRouter synthesis into ResearchBundle JSON.
 */
export async function runPenumbraResearch(
  input: PenumbraResearchInput,
  onChunk?: (delta: string) => void,
): Promise<PenumbraResearchOutcome> {
  const liveExaAvailable = exaPenumbraConfigured() && penumbraLiveExaEnabled()
  const offlineExaAvailable = penumbraOfflineExaEnabled()

  if (!liveExaAvailable && !offlineExaAvailable) {
    return fail('disabled', Date.now())
  }

  const started = Date.now()
  const conversationId = conversationIdFor(input)
  const cacheKey = buildPenumbraCacheKey(input.query, input.matterSlug)

  if (!input.skipCache) {
    const cached = await getPenumbraResearchCache(cacheKey)
    if (cached) {
      const latencyMs = Date.now() - started
      console.info(
        '[penumbra-exa]',
        JSON.stringify({
          event: 'research_cache_hit',
          latencyMs,
          conversationId,
          cacheKey: cacheKey.slice(0, 12),
          hitCount: cached.hitCount,
          sourceCount: cached.bundle.sources.length,
        }),
      )
      return {
        ok: true,
        result: {
          bundle: cached.bundle,
          conversationId,
          latencyMs,
          cacheHit: true,
          cacheKey,
        },
      }
    }
  }

  try {
    const planned: ExaResearchQuery[] = input.exaQueries?.length
      ? input.exaQueries
      : [
          { id: 'full', query: input.query.slice(0, 1800), scope: 'open' },
          {
            id: 'official',
            query: `${input.query.slice(0, 400)} United Kingdom official guidance GOV.UK Shelter ACAS Citizens Advice`,
            scope: 'allowlist',
          },
          {
            id: 'help-free',
            query: `${input.query.slice(0, 280)} England free advice helpline Shelter Citizens Advice law centre legal aid get help`,
            scope: 'open',
          },
          {
            id: 'help-paid',
            query: `${input.query.slice(0, 280)} England find a solicitor SRA Law Society regulated directory`,
            scope: 'open',
          },
        ]
    const queryPlan = planned.map((q) => `${q.scope}:${q.query}`).join('\n---\n')
    const hitsCacheKey = buildExaHitsCacheKey(queryPlan, input.matterSlug)
    const numResults = Number(process.env.PENUMBRA_EXA_NUM_RESULTS || 10)
    const timeoutMs = Number(process.env.PENUMBRA_EXA_TIMEOUT_MS || 20_000)

    const slots = input.coverageSlots || []
    const story = input.story || input.query
    const matterSlug = primaryMatterSlug(input.matterSlug) || input.matterSlug
    const offline = offlineExaAvailable
      ? searchOfflineExaIndexForPenumbra(planned[0]?.query || input.query, {
          matterSlug,
          limit: numResults,
          slots,
          story,
        })
      : { hits: [], matchedPageCount: 0, matchedTopicKeys: [] as string[] }

    let exaHits = offline.hits
    let helpHits = offline.hits
    let exaRequestId: string | undefined
    let exaSource: 'offline' | 'live' | 'hybrid' = offline.hits.length ? 'offline' : 'live'
    let hitsFromCache = false

    if (!input.skipCache) {
      const cachedHits = await getPenumbraExaHitsCache(hitsCacheKey)
      if (cachedHits?.hits.length) {
        const cachedMerged = mergeExaSearchHits(cachedHits.hits, offline.hits, 24)
        helpHits = cachedMerged
        exaHits = filterHitsBySlots(cachedMerged, slots, story)
        hitsFromCache = true
        exaSource = offline.hits.length ? 'hybrid' : 'live'
        console.info(
          '[penumbra-exa]',
          JSON.stringify({
            event: 'exa_hits_cache_hit',
            conversationId,
            hitCount: cachedHits.hits.length,
          }),
        )
      }
    }

    if (!hitsFromCache && liveExaAvailable) {
      const liveRuns = await Promise.all(
        planned.map((q) =>
          searchExaForPenumbra(q.query, {
            numResults,
            timeoutMs,
            scope: q.scope,
          }),
        ),
      )
      exaRequestId = liveRuns.map((r) => r.requestId).filter(Boolean).join(',')
      let merged: typeof offline.hits = []
      for (const run of liveRuns) {
        merged = mergeExaSearchHits(merged, run.hits, 24)
      }
      helpHits = mergeExaSearchHits(merged, offline.hits, 24)
      exaHits = filterHitsBySlots(helpHits, slots, story)
      exaSource = offline.hits.length && liveRuns.some((r) => r.hits.length)
        ? 'hybrid'
        : liveRuns.some((r) => r.hits.length)
          ? 'live'
          : 'offline'
      if (!input.skipCache && helpHits.length) {
        await putPenumbraExaHitsCache({
          cacheKey: hitsCacheKey,
          query: queryPlan,
          matterSlug: input.matterSlug,
          hits: helpHits,
        })
      }
    } else if (!hitsFromCache && !offline.hits.length) {
      return fail('empty_bundle', started, {
        conversationId,
        errorMessage: 'offline Exa index returned no hits and live Exa is disabled',
      })
    }

    const exaSources = exaHitsToSources(exaHits)
    const canonicalSources = filterCanonicalBySlots(input.canonicalSources, slots, story)
    const allowedSourceIds = new Set([
      ...canonicalSources.map((source) => source.id),
      ...exaSources.map((source) => source.id),
    ])

    let bundle: ResearchBundle | null = null
    let reply = ''
    let parsed: ReturnType<typeof parseResearchBundle> = null

    if (penumbraLlmSynthEnabled()) {
      const prompt = [
        researchBundlePrompt({
          mode: input.mode,
          query: input.query,
          context: `${input.sourceContext}\n\nExa full-search candidates (already retrieved; cite by id):\n${formatExaContext(exaSources)}`,
        }),
        'Legal Shaman already froze a case brief. Research the whole matter from scratch using Exa results.',
        'Do not elect a new primary matter that the brief excluded. Do not invent sources.',
        'Every external source must use its provided web- id and https URL.',
        'Return JSON only.',
      ].join('\n\n')
      if (onChunk) onChunk('…')
      reply = await synthesizeResearchBundle(prompt)
      if (onChunk && reply) onChunk(reply.slice(0, 200))
      parsed = parseResearchBundle(reply, input.mode, allowedSourceIds)
      if (parsed) {
        bundle = canonicalizeResearchBundle(parsed, [...canonicalSources, ...exaSources])
      }
    }

    if (!bundle) {
      bundle = deterministicBundleFromSources(
        input.mode,
        input.query,
        canonicalSources,
        exaSources,
        slots,
        story,
      )
      if (bundle && !penumbraLlmSynthEnabled()) {
        console.info(
          '[penumbra-exa]',
          JSON.stringify({
            event: 'research_exa_memo_no_llm',
            conversationId,
            exaSource,
            sourceCount: bundle.sources.length,
            hitsFromCache,
          }),
        )
      }
    }

    if (!bundle) {
      return fail('parse_failed', started, {
        conversationId,
        replyLength: reply.length,
        errorMessage: `no Third Eye bundle; reply=${reply.slice(0, 240)}`,
      })
    }

    const discoveredHelp = discoverHelpFromExaHits(helpHits, {
      matterSlug: input.matterSlug,
      topicId: matterSlug || input.matterSlug,
    })
    bundle.freeResources = mergeHelpResources(bundle.freeResources || [], discoveredHelp)

    if (bundle.sources.length === 0 && bundle.questions.length === 0) {
      return fail('empty_bundle', started, {
        conversationId,
        replyLength: reply.length,
        parsedSourceCount: parsed?.sources.length || 0,
        parsedQuestionCount: parsed?.questions.length || 0,
        errorMessage: 'canonical bundle had no sources or questions',
      })
    }

    const latencyMs = Date.now() - started
    console.info(
      '[penumbra-exa]',
      JSON.stringify({
        event: 'research_success',
        latencyMs,
        conversationId,
        exaRequestId,
        exaHitCount: exaHits.length,
        exaSource,
        offlineHitCount: offline.hits.length,
        offlineMatchedPages: offline.matchedPageCount,
        matterTopicKey: offline.matterTopicKey,
        matchedTopicKeys: offline.matchedTopicKeys,
        parsedSourceCount: bundle.sources.length,
        parsedQuestionCount: bundle.questions.length,
        helpLeadCount: bundle.freeResources.length,
        cacheKey: cacheKey.slice(0, 12),
      }),
    )

    if (!input.skipCache) {
      await putPenumbraResearchCache({
        cacheKey,
        query: input.query,
        matterSlug: input.matterSlug,
        bundle,
      })
    }

    return {
      ok: true,
      result: {
        bundle,
        conversationId,
        latencyMs,
        cacheHit: false,
        cacheKey,
        exaSource,
        offlineHitCount: offline.hits.length,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timeout =
      message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout')
    return fail(timeout ? 'timeout' : 'sdk_error', started, {
      conversationId,
      errorMessage: message.slice(0, 500),
    })
  }
}

export function penumbraResearchEnabled(): boolean {
  const pilot = /^(1|true|yes|on)$/i.test(process.env.ENABLE_ARAMB_PILOT?.trim() || '')
  return pilot && (exaPenumbraConfigured() || penumbraOfflineExaEnabled())
}
