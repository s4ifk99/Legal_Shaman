import type { ResearchBundle } from './researchBundle'
import type { SessionState } from './types'

export type PenumbraResearchResponse = {
  conversationId: string
  status: 'needs_input' | 'complete'
  questions: string[]
  bundle: ResearchBundle
  fallback?: boolean
  latencyMs?: number
  tokens?: number
  cacheHit?: boolean
  exaSource?: string
}

export function newPenumbraCaseKey(): string {
  return `case-${crypto.randomUUID()}`
}

const PENUMBRA_REQUEST_TIMEOUT_MS = 95_000

async function fetchPenumbra(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    PENUMBRA_REQUEST_TIMEOUT_MS,
  )
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function requestPenumbraResearch(
  session: SessionState,
  input: { message?: string; stream?: boolean },
): Promise<PenumbraResearchResponse | null> {
  const state = session.penumbraResearch
  if (!state?.caseKey || session.searchMode !== 'penumbra') return null
  const requestId = `aramb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetchPenumbra('/api/coherence/aramb/research', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': requestId,
      'x-idempotency-key': requestId,
    },
    body: JSON.stringify({
      latestText: sessionAnswerText(session),
      understanding: session.briefUnderstanding,
      clientQuestion: session.clientQuestion,
      message: input.message,
      searchMode: session.searchMode,
      caseKey: state.caseKey,
      conversationId: state.conversationId || undefined,
      matterFrame: session.matterFrame || undefined,
    }),
  })
  let data: (PenumbraResearchResponse & { error?: string; fallback?: boolean }) | null = null
  if (input.stream && res.ok && res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    while (true) {
      const chunk = await reader.read()
      pending += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done })
      const events = pending.split('\n\n')
      pending = events.pop() || ''
      for (const event of events) {
        const eventName = event.match(/^event:\s*(.+)$/m)?.[1]
        const payload = event.match(/^data:\s*(.+)$/m)?.[1]
        if (!payload) continue
        const value = JSON.parse(payload) as PenumbraResearchResponse & { error?: string; fallback?: boolean }
        if (eventName === 'result') data = value
        if (eventName === 'error') throw new Error(value.error || 'aramb_research_failed')
      }
      if (chunk.done) break
    }
  } else {
    data = (await res.json().catch(() => null)) as
      | (PenumbraResearchResponse & { error?: string; fallback?: boolean })
      | null
  }
  if (!res.ok || !data?.bundle) {
    throw new Error(data?.error || 'aramb_research_unavailable')
  }
  return data
}

function sessionAnswerText(session: SessionState): string {
  return [
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.rawInputs.slice(-3),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 6000)
}
