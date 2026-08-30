import 'server-only'

import { createHash } from 'node:crypto'
import { Aramb } from '@aramb-ai/sdk'
import {
  canonicalizeResearchBundle,
  parseResearchBundle,
  researchBundlePrompt,
  type ResearchBundle,
  type ResearchSource,
} from '@/lib/coherence/researchBundle'
import type { SearchMode } from '@/lib/coherence/types'
import { ARAMB_TOOL_MANIFEST } from '@/lib/aramb/tools'

type ArambResearchInput = {
  mode: SearchMode
  query: string
  sourceContext: string
  canonicalSources: ResearchSource[]
  tenantKey: string
  conversationId?: string
}

export type ArambResearchResult = {
  bundle: ResearchBundle
  conversationId: string
  tokens?: number
  latencyMs: number
}

let cachedClient: Aramb | null = null
let cachedConfig = ''

function config() {
  const apiKey = process.env.ARAMB_KEY?.trim() || ''
  const agentId = process.env.ARAMB_AGENT_ID?.trim() || ''
  const baseUrl = process.env.ARAMB_BASE_URL?.trim() || ''
  return { apiKey, agentId, baseUrl }
}

export function arambPilotEnabled(): boolean {
  const enabled = /^(1|true|yes|on)$/i.test(process.env.ENABLE_ARAMB_PILOT?.trim() || '')
  const { apiKey, agentId } = config()
  return enabled && Boolean(apiKey && agentId)
}

/** Stable, non-reversible tenant key; never send an email or case text as subTenant. */
export function arambSubTenant(tenantKey: string): string {
  return `ls-${createHash('sha256').update(`legal-shaman:${tenantKey}`).digest('hex').slice(0, 32)}`
}

function client(): Aramb {
  const { apiKey, baseUrl } = config()
  const key = `${apiKey}:${baseUrl}`
  if (!cachedClient || cachedConfig !== key) {
    cachedClient = new Aramb({
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    })
    cachedConfig = key
  }
  return cachedClient
}

/**
 * The Shaman research boundary. The agent receives curated Legal Shaman candidates,
 * then may use capabilities configured on The Shaman agent for open research.
 * It cannot publish a Legal Shaman answer directly.
 */
export async function runArambResearch(
  input: ArambResearchInput,
  onChunk?: (delta: string) => void,
): Promise<ArambResearchResult | null> {
  if (!arambPilotEnabled()) return null
  const { agentId } = config()
  const started = Date.now()
  let conversationId = input.conversationId || ''
  const session = client().session({
    agentId,
    subTenant: arambSubTenant(input.tenantKey),
    ...(conversationId
      ? { conversationId }
      : {
          newConversation: true,
          ephemeral: true,
          ephemeralTtlSeconds: 300,
          ephemeralIdleTimeoutSeconds: 120,
        }),
  })
  session.once('conversationCreated', (createdId) => {
    conversationId = createdId
  })

  try {
    const boundedTools = ARAMB_TOOL_MANIFEST.map((tool) => `${tool.name}: ${tool.description}`).join('\n')
    const prompt = `${researchBundlePrompt({
        mode: input.mode,
        query: input.query,
        context: input.sourceContext,
    })}\n\nCurated Legal Shaman tool trace (already executed; use it first):\n${boundedTools}\n\nAfter the curated phase, use The Shaman's configured web/search/browser tools to fill genuine gaps. Keep every such source labelled as external and unverified.`
    let reply = ''
    let tokens: number | undefined
    if (onChunk) {
      for await (const chunk of session.stream(prompt)) {
        reply += chunk.delta
        onChunk(chunk.delta)
      }
    } else {
      const result = await session.run(prompt)
      reply = result.reply
      tokens = result.usage?.tokens
    }
    const allowedSourceIds = new Set(input.canonicalSources.map((source) => source.id))
    const parsed = parseResearchBundle(reply, input.mode, allowedSourceIds)
    const bundle = parsed ? canonicalizeResearchBundle(parsed, input.canonicalSources) : null
    if (!bundle || (bundle.sources.length === 0 && bundle.questions.length === 0)) return null
    return {
      bundle,
      conversationId,
      tokens,
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    console.warn('[aramb-pilot] research failed:', error instanceof Error ? error.message : error)
    return null
  } finally {
    await session.close().catch(() => undefined)
  }
}
