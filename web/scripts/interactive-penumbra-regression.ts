import { createInitialSession } from '../lib/coherence/sense'
import { requestPenumbraResearch } from '../lib/coherence/penumbraResearch'

const bundle = {
  mode: 'penumbra' as const,
  status: 'needs_input' as const,
  questions: ['What did the university say about withdrawal?'],
  sources: [{
    id: 'wiki-course-fees',
    title: 'Course fees',
    url: '',
    tier: 'wiki' as const,
    excerpt: 'Canonical excerpt.',
    origin: 'curated' as const,
    verified: true,
  }],
  claims: [{
    claim: 'The policy is fact-sensitive.',
    sourceIds: ['wiki-course-fees'],
    confidence: 'medium' as const,
  }],
  conflicts: [],
  missingFacts: [],
  nextActions: [],
}

async function main() {
  const originalFetch = globalThis.fetch
  const requests: Array<Record<string, unknown>> = []
  globalThis.fetch = (async (_input, init) => {
    requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
    if (requests.length === 1) {
      return Response.json({
        conversationId: 'conv-mock-1',
        status: 'needs_input',
        questions: bundle.questions,
        bundle,
      })
    }
    const complete = { ...bundle, status: 'complete' as const, questions: [] }
    const events = [
      'event: status\ndata: {"status":"running"}\n\n',
      'event: progress\ndata: {"characters":12}\n\n',
      `event: result\ndata: ${JSON.stringify({
        conversationId: 'conv-mock-1',
        status: 'complete',
        questions: [],
        bundle: complete,
      })}\n\n`,
    ].join('')
    return new Response(events, {
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch

  try {
    const base = {
      ...createInitialSession(),
      searchMode: 'penumbra' as const,
      clientQuestion: 'Can the university charge the remaining tuition?',
      whatHappened: 'The university withdrew me from my course.',
      penumbraResearch: {
        status: 'starting' as const,
        caseKey: 'case-mock-123456789',
        questions: [],
        updatedAt: new Date().toISOString(),
      },
    }
    const first = await requestPenumbraResearch(base, { stream: false })
    if (!first || first.conversationId !== 'conv-mock-1' || first.status !== 'needs_input') {
      throw new Error('mock start did not return needs_input')
    }
    const resumed = await requestPenumbraResearch({
      ...base,
      penumbraResearch: {
        ...base.penumbraResearch,
        status: 'awaiting_input',
        conversationId: first.conversationId,
        questions: first.questions,
        bundle: first.bundle,
      },
    }, { message: 'The email says 50% is due.', stream: true })
    if (!resumed || resumed.status !== 'complete') throw new Error('mock resume stream did not complete')
    if (requests[0].conversationId || requests[1].conversationId !== 'conv-mock-1') {
      throw new Error('conversation was not isolated and resumed')
    }
    console.log('PASS interactive-penumbra mocked start/resume/stream')
  } finally {
    globalThis.fetch = originalFetch
  }
}

main().catch((error) => {
  console.error(`FAIL interactive-penumbra mocked start/resume/stream — ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
