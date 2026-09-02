import 'server-only'

import { createHash, randomUUID } from 'node:crypto'

import OpenAI from 'openai'

import { authorityTierForUrl } from '@/lib/coherence/authorityAllowlist'
import {
  canonicalizeResearchBundle,
  parseResearchBundle,
  researchBundlePrompt,
  type ResearchBundle,
  type ResearchSource,
} from '@/lib/coherence/researchBundle'
import type { SearchMode } from '@/lib/coherence/types'
import { chat } from '@/lib/llm/client'
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
  getPenumbraResearchCache,
  putPenumbraResearchCache,
} from '@/lib/penumbra/researchCache'

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

/** Last-resort bundle from indexed sources when LLM synthesis fails. */
function deterministicBundleFromSources(
  mode: SearchMode,
  query: string,
  canonicalSources: ResearchSource[],
  exaSources: ResearchSource[],
): ResearchBundle | null {
  const sources = [...canonicalSources, ...exaSources]
  if (sources.length < 2) return null

  const claims = exaSources.slice(0, 4).map((source) => ({
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
    answerDraft:
      `Indexed UK guidance was retrieved for: ${questionLead}. The points below come from offline authority sources — verify each link before relying on it.`,
    freeResources: [],
  }
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
    const exaQuery = [
      input.query,
      'United Kingdom England Wales official guidance Citizens Advice GOV.UK',
    ]
      .filter(Boolean)
      .join('. ')
      .slice(0, 2000)

    const numResults = Number(process.env.PENUMBRA_EXA_NUM_RESULTS || 8)
    const offline = offlineExaAvailable
      ? searchOfflineExaIndexForPenumbra(exaQuery, {
          matterSlug: input.matterSlug,
          limit: numResults,
        })
      : { hits: [], matchedPageCount: 0, matchedTopicKeys: [] as string[] }
    let exaHits = offline.hits
    let exaRequestId: string | undefined
    let exaSource: 'offline' | 'live' | 'hybrid' = offline.hits.length ? 'offline' : 'live'

    // Third Eye always uses live Exa when configured; offline index pre-fills and merges.
    if (liveExaAvailable) {
      const live = await searchExaForPenumbra(exaQuery, {
        numResults,
        timeoutMs: Number(process.env.PENUMBRA_EXA_TIMEOUT_MS || 20_000),
      })
      exaRequestId = live.requestId
      exaHits = mergeExaSearchHits(offline.hits, live.hits, numResults)
      exaSource = offline.hits.length && live.hits.length ? 'hybrid' : live.hits.length ? 'live' : 'offline'
    } else if (!offline.hits.length) {
      return fail('empty_bundle', started, {
        conversationId,
        errorMessage: 'offline Exa index returned no hits and live Exa is disabled',
      })
    }
    const exaSources = exaHitsToSources(exaHits)
    const allowedSourceIds = new Set([
      ...input.canonicalSources.map((source) => source.id),
      ...exaSources.map((source) => source.id),
    ])

    const prompt = [
      researchBundlePrompt({
        mode: input.mode,
        query: input.query,
        context: `${input.sourceContext}\n\nExa open-web candidates (already retrieved; cite by id):\n${formatExaContext(exaSources)}`,
      }),
      'Curated Legal Shaman wiki and authority tools were already executed before this turn.',
      'Use the Exa candidates above for genuine gaps. Do not invent sources.',
      'Every external source must use its provided web- id and https URL.',
      'Return JSON only.',
    ].join('\n\n')

    if (onChunk) onChunk('…')

    const reply = await synthesizeResearchBundle(prompt)

    if (onChunk && reply) onChunk(reply.slice(0, 200))

    const parsed = parseResearchBundle(reply, input.mode, allowedSourceIds)
    let bundle: ResearchBundle | null = null
    if (parsed) {
      bundle = canonicalizeResearchBundle(parsed, [...input.canonicalSources, ...exaSources])
    } else {
      bundle = deterministicBundleFromSources(
        input.mode,
        input.query,
        input.canonicalSources,
        exaSources,
      )
      if (bundle) {
        console.warn(
          '[penumbra-exa]',
          JSON.stringify({
            event: 'research_llm_fallback_deterministic',
            conversationId,
            exaSource,
            sourceCount: bundle.sources.length,
          }),
        )
      }
    }

    if (!bundle) {
      return fail('parse_failed', started, {
        conversationId,
        replyLength: reply.length,
        errorMessage: `parseResearchBundle returned null; reply=${reply.slice(0, 240)}`,
      })
    }

    if (bundle.sources.length === 0 && bundle.questions.length === 0) {
      return fail('empty_bundle', started, {
        conversationId,
        replyLength: reply.length,
        parsedSourceCount: parsed.sources.length,
        parsedQuestionCount: parsed.questions.length,
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
