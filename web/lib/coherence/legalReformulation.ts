import type { SessionState } from './types'
import {
  assessMinorGate,
  minorGateTextFromParts,
  type MinorGateOutcome,
} from './minorGate'

export type ReformulationKind = 'reformulation' | 'refuse' | 'clarify_age'

export interface ReformulationResult {
  kind: ReformulationKind
  /** Proposed search question (empty when refuse / clarify) */
  text: string
  refuseReason?: string
  escalateHint?: string
  clarifyPrompt?: string
  /** Deterministic gate outcome when it short-circuited the LLM */
  gateOutcome?: MinorGateOutcome
  /** Original lay opener used as input */
  original: string
}

const EXPERT_SYSTEM = `You help a UK access-to-justice search product prepare a clearer question for triage and retrieval.
You are NOT a lawyer and must not give legal advice, predict outcomes, or tell the user what to do.

Rules:
1. Preserve the user's facts; do not invent parties, statutes, visa names, or legal conclusions.
2. Issue-spot gently: name plausible UK frames in plain English (e.g. ILR refusal, character/suitability, overstaying, parental responsibility, county court claim, identity fraud).
3. Prefer one clear question a solicitor or search system could start from — include the key legal topic words a GOV.UK / Citizens Advice page would use.
4. Do not add unnecessary legalese or US terms (e.g. "lawsuit", "statute of limitations" — use UK wording if needed: appeal deadline, time limit).
5. If the user's question is already clear and specific, return it unchanged (or with tiny grammar fixes). Do NOT use REFUSE for already-clear questions.
6. REFUSE to reformulate ONLY if: the user appears under 18; there is an imminent detention/removal/overstaying risk needing urgent human help; or reformulation would require guessing missing facts. In those cases reply exactly:
REFUSE: <short reason>
ESCALATE: <what the product should surface next>
7. Never invent that a document is "defective", that someone "has a claim", or that an outcome is likely.
8. Reply with only the reformulated question, or REFUSE/ESCALATE lines — no preamble, no JSON, no markdown fences.`

function openerFromSession(session: SessionState): string {
  const raw = session.rawInputs.find((r) => r.trim().length >= 8)?.trim()
  if (raw) return raw
  if (session.whatHappened.trim()) return session.whatHappened.trim()
  return session.events.map((e) => e.label).filter(Boolean).join('. ')
}

function buildUserPayload(session: SessionState, original: string): string {
  return JSON.stringify(
    {
      lay_opener: original,
      matterType: session.matterType,
      mode: session.mode,
      jurisdiction: session.jurisdiction,
      locationHint: session.locationHint,
      whatHappened: session.whatHappened,
      howCaused: session.howCaused,
      goal: session.goal,
      softFlags: session.softFlags,
      safetyRisk: session.safetyRisk,
      recentInputs: session.rawInputs.slice(-4),
    },
    null,
    2,
  )
}

export function parseReformulationResponse(raw: string, original: string): ReformulationResult {
  let text = raw.replace(/^```[\w]*\s*/i, '').replace(/```$/i, '').trim()

  // Models sometimes wrap the question in JSON despite the plain-text instruction.
  if (text.startsWith('{') && text.includes('}')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const q =
        (typeof parsed.question === 'string' && parsed.question) ||
        (typeof parsed.reformulated === 'string' && parsed.reformulated) ||
        (typeof parsed.text === 'string' && parsed.text) ||
        (typeof parsed.query === 'string' && parsed.query) ||
        ''
      if (q.trim().length >= 8) text = q.trim()
    } catch {
      const m = text.match(/"question"\s*:\s*"((?:\\.|[^"\\])*)"/)
      if (m?.[1]) {
        text = m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim()
      }
    }
  }

  const refuseMatch = text.match(/REFUSE:\s*(.+?)(?:\n|$)/i)
  const escalateMatch = text.match(/ESCALATE:\s*(.+?)(?:\n|$)/i)

  if (refuseMatch || /^REFUSE\b/i.test(text)) {
    return {
      kind: 'refuse',
      text: '',
      original,
      refuseReason: (refuseMatch?.[1] || text).trim().slice(0, 280),
      escalateHint: (escalateMatch?.[1] || 'Speak to a regulated adviser or emergency support if you are at risk.').trim().slice(0, 280),
    }
  }

  const cleaned = text
    .replace(/^["']|["']$/g, '')
    .replace(/^(reformulated question|question)\s*:\s*/i, '')
    .trim()

  if (!cleaned || cleaned.length < 8) {
    return { kind: 'reformulation', text: original, original }
  }

  return {
    kind: 'reformulation',
    text: cleaned.slice(0, 420),
    original,
  }
}

/** Run the hard minor gate over opener + session narrative. */
export function assessSessionMinorGate(session: SessionState) {
  const original = openerFromSession(session)
  const text = minorGateTextFromParts([
    original,
    session.whatHappened,
    ...session.rawInputs,
    ...(session.softFlags || []),
  ])
  return { original, assessment: assessMinorGate(text) }
}

function resultFromGate(
  original: string,
  assessment: ReturnType<typeof assessMinorGate>,
): ReformulationResult | null {
  if (assessment.outcome === 'refuse_escalate') {
    return {
      kind: 'refuse',
      text: '',
      original,
      gateOutcome: 'refuse_escalate',
      refuseReason: assessment.refuseReason,
      escalateHint: assessment.escalateHint,
    }
  }
  if (assessment.outcome === 'clarify_age') {
    return {
      kind: 'clarify_age',
      text: '',
      original,
      gateOutcome: 'clarify_age',
      clarifyPrompt: assessment.clarifyPrompt,
    }
  }
  return null
}

/**
 * Expert-prompted legal question reformulation (Atwell-style arm B).
 * Hard minor gate runs first and skips the LLM on refuse / clarify.
 * Uses the existing OpenRouter Vite proxy. Returns null on transport failure.
 */
export async function reformulateLegalQuery(
  session: SessionState,
  signal?: AbortSignal,
  options?: { skipMinorGate?: boolean; ageConfirmedAdult?: boolean },
): Promise<ReformulationResult | null> {
  const original = openerFromSession(session)
  if (!original) return null

  if (!options?.skipMinorGate && !options?.ageConfirmedAdult) {
    const gated = resultFromGate(original, assessSessionMinorGate(session).assessment)
    if (gated) return gated
  }

  try {
    const res = await fetch('/api/coherence/llm/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: EXPERT_SYSTEM,
        user: `Lay UK user session JSON:\n${buildUserPayload(session, original)}\n\nProduce either one reformulated question, or REFUSE/ESCALATE as specified.`,
      }),
      signal,
    })
    const data = (await res.json()) as { content?: string; error?: string }
    if (!res.ok || !data.content) return null
    return parseReformulationResponse(data.content, original)
  } catch {
    return null
  }
}

/** Prefer confirmed reformulation when building retrieval text. */
export function withConfirmedQuery(parts: Array<string | undefined | null>, session: SessionState): string[] {
  const confirmed = session.confirmedSearchQuery?.trim()
  if (confirmed) return [confirmed, ...parts.filter(Boolean) as string[]]
  return parts.filter(Boolean) as string[]
}
