import type { PredictiveChoice, Prompt, QuestionKind, SessionState } from './types'
import { knownCausationFacts, openCausationGaps } from './causation'

const ADVICE_BAN =
  /\b(you should sue|you have a (strong|good) claim|i advise|legal advice|you will win|definitely entitled)\b/i

const GENERIC_BAN =
  /^(tell me more|can you (please )?explain|what happened\??|what do you want\??|please provide more (details|information))\s*$/i

function anchorsFromSession(session: SessionState): string[] {
  const parts = [
    session.whatHappened,
    session.howCaused,
    ...session.rawInputs.slice(-3),
    ...session.events.map((e) => e.rawSpan || e.label),
    ...session.parties.map((p) => p.label),
    session.locationHint,
  ]
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)

  const unique: string[] = []
  for (const p of parts) {
    if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) unique.push(p)
  }
  return unique.slice(0, 8)
}

function isGrounded(text: string, anchors: string[]): boolean {
  if (anchors.length === 0) return true
  const lower = text.toLowerCase()
  return anchors.some((a) => {
    const token = a.toLowerCase().slice(0, 24)
    return token.length >= 4 && lower.includes(token)
  })
}

function parsePromptJson(content: string, fallback: Prompt): Prompt | null {
  try {
    const cleaned = content.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    const data = JSON.parse(cleaned) as {
      text?: string
      kind?: string
      reason?: string
      options?: { id?: string; label?: string; value?: string }[]
    }

    const text = (data.text || '').trim()
    if (!text || text.length < 12 || text.length > 320) return null
    if (ADVICE_BAN.test(text) || GENERIC_BAN.test(text)) return null

    const kind: QuestionKind = data.kind === 'closed' ? 'closed' : data.kind === 'open' ? 'open' : fallback.kind
    const options: PredictiveChoice[] = (data.options ?? [])
      .map((o, i) => ({
        id: o.id || `llm-${i}`,
        label: (o.label || '').trim(),
        value: (o.value || o.label || '').trim(),
      }))
      .filter((o) => o.label && o.value)
      .slice(0, 6)

    if (kind === 'closed' && options.length < 2) return null

    return {
      id: fallback.id,
      kind,
      text,
      reason: (data.reason || fallback.reason || '').trim() || fallback.reason,
      options: options.length ? options : fallback.options,
    }
  } catch {
    return null
  }
}

function buildLlmPayload(session: SessionState, heuristic: Prompt) {
  const gaps = openCausationGaps(session)
  const topGap = gaps[0]
  const anchors = anchorsFromSession(session)
  const facts = knownCausationFacts(session)

  const system = `You write ONE powerful follow-up question for a UK legal triage intake (information + signpost only — NOT a solicitor, NOT legal advice).

Rules:
- Stay on the assigned causation GAP only. Do not change the gap id.
- Ground the question in the client's own words. Quote or clearly echo at least one anchor phrase.
- Never give legal advice, predictions, or conclusions ("you should sue", "strong claim", etc.).
- Prefer specific over generic. Ban vague prompts like "tell me more" or "what happened?" with no reference.
- kind must be "open" or "closed".
- For closed: 2–5 short tap options, each option value should also echo the situation.
- For open: 2–4 optional tap starters that still leave room to type.
- Return JSON only: { "text": string, "kind": "open"|"closed", "reason": string, "options": [{ "id", "label", "value" }] }`

  const user = JSON.stringify(
    {
      gap: topGap
        ? { id: topGap.id, label: topGap.label, priority: topGap.priority, reason: topGap.reason, preferredKind: topGap.kind }
        : { id: heuristic.id, label: heuristic.id, reason: heuristic.reason },
      heuristic_question: {
        text: heuristic.text,
        kind: heuristic.kind,
        options: heuristic.options ?? [],
      },
      session: {
        matterType: session.matterType,
        mode: session.mode,
        jurisdiction: session.jurisdiction,
        locationHint: session.locationHint,
        whatHappened: session.whatHappened,
        howCaused: session.howCaused,
        goal: session.goal,
        parties: session.parties,
        documents: session.documents,
        events: session.events.map((e) => ({ label: e.label, dateApprox: e.dateApprox })),
        recentInputs: session.rawInputs.slice(-4),
        softFlags: session.softFlags,
        knownFacts: facts,
        anchors,
      },
    },
    null,
    2,
  )

  return { system, user, anchors }
}

/**
 * Ask OpenRouter (via Vite proxy) to rewrite the heuristic gap question.
 * Returns null on any failure — caller keeps the template question.
 */
export async function enhanceQuestionWithLlm(
  session: SessionState,
  heuristic: Prompt,
  signal?: AbortSignal,
): Promise<Prompt | null> {
  // Opening screen: no enhancement needed
  if (heuristic.id === 'open' || session.rawInputs.length === 0) return null

  const { system, user, anchors } = buildLlmPayload(session, heuristic)

  try {
    const res = await fetch('/api/coherence/llm/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, user }),
      signal,
    })

    const data = (await res.json()) as { content?: string; error?: string; fallback?: boolean }
    if (!res.ok || !data.content) return null

    const parsed = parsePromptJson(data.content, heuristic)
    if (!parsed) return null
    if (!isGrounded(parsed.text, anchors)) {
      // Force grounding if model drifted
      const anchor = anchors[0]
      if (!anchor) return null
      parsed.text = `You said “${anchor.length > 64 ? `${anchor.slice(0, 63)}…` : anchor}”. ${parsed.text}`
      if (!isGrounded(parsed.text, anchors) || ADVICE_BAN.test(parsed.text)) return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function getLlmStatus(): Promise<{ configured: boolean; model: string }> {
  try {
    const res = await fetch('/api/coherence/llm/status')
    if (!res.ok) return { configured: false, model: '' }
    return (await res.json()) as { configured: boolean; model: string }
  } catch {
    return { configured: false, model: '' }
  }
}
