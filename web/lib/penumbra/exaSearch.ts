import 'server-only'

import { EXA_RD_INCLUDE_DOMAINS } from '@/lib/coherence/authorityAllowlist'

export type ExaSearchHit = {
  id: string
  url: string
  title: string
  excerpt: string
  publishedDate?: string
}

type ExaSearchResponse = {
  results?: Array<{
    id?: string
    url?: string
    title?: string
    text?: string
    summary?: string
    highlights?: string[]
    publishedDate?: string
  }>
  requestId?: string
}

function exaApiKey(): string | undefined {
  return process.env.EXA_API_KEY?.trim() || undefined
}

function hitExcerpt(result: NonNullable<ExaSearchResponse['results']>[number]): string {
  const highlights = Array.isArray(result.highlights)
    ? result.highlights.map((h) => String(h || '').trim()).filter(Boolean)
    : []
  if (highlights.length) return highlights.join(' ').replace(/\s+/g, ' ').trim()
  const summary = String(result.summary || '').replace(/\s+/g, ' ').trim()
  if (summary) return summary
  return String(result.text || '').replace(/\s+/g, ' ').trim()
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

/** UK-biased Exa search for Penumbra gap-fill (allowlisted domains only). */
export async function searchExaForPenumbra(
  query: string,
  opts: { numResults?: number; timeoutMs?: number } = {},
): Promise<{ hits: ExaSearchHit[]; requestId?: string }> {
  const apiKey = exaApiKey()
  if (!apiKey) return { hits: [] }

  const numResults = Math.min(Math.max(opts.numResults ?? 8, 1), 12)
  const timeoutMs = opts.timeoutMs ?? 25_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query.slice(0, 2000),
        type: 'auto',
        numResults,
        userLocation: 'GB',
        includeDomains: EXA_RD_INCLUDE_DOMAINS,
        contents: {
          highlights: { numSentences: 3 },
          summary: true,
        },
      }),
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Exa search ${res.status}: ${text.slice(0, 200)}`)
    }

    const data = (await res.json()) as ExaSearchResponse
    const hits: ExaSearchHit[] = []
    for (const result of data.results || []) {
      const url = String(result.url || result.id || '').trim()
      const title = String(result.title || '').trim()
      const excerpt = hitExcerpt(result).slice(0, 900)
      if (!url.startsWith('https://') || !title || !excerpt) continue
      hits.push({
        id: stableWebSourceId(url),
        url,
        title: title.slice(0, 240),
        excerpt,
        publishedDate: result.publishedDate,
      })
    }
    return { hits, requestId: data.requestId }
  } finally {
    clearTimeout(timer)
  }
}

export function exaPenumbraConfigured(): boolean {
  return Boolean(exaApiKey())
}
