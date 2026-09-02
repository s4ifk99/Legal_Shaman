import type { MatterType, Mode, Party, Prompt, SessionState, TimelineEvent, Jurisdiction } from './types'
import { maximiseLocalCoherence } from './coherence'
import { proposeLegalFrames } from './frames'
import { sanitizeIntakeNarrative } from './sense'

export type OrchestrateSnippet = {
  title: string
  snippet: string
  url?: string
  authority?: string
  dworkinKind?: string | null
  layer?: string
  id?: string
  score?: number
}

export type OrchestrateTimeline = {
  events: { label: string; rawSpan: string; dateApprox?: string; actors?: string[] }[]
  whatHappened: string
  understanding?: string
  clientQuestion?: string
  matterConfidence?: number
  frameHints?: string[]
  openUncertainties?: { id: string; whyItMatters: string; suggestedAsk: string }[]
  goal?: string
  mode?: string
  parties?: Party[]
  documents?: string[]
  matterType?: string
  jurisdiction?: string
  locationHint?: string
  howCaused?: string
  topicId?: string
}

export type OrchestrateResult = {
  timeline: OrchestrateTimeline
  snippets: OrchestrateSnippet[]
  prompt: Prompt | null
  model?: string
}

const uid = () => Math.random().toString(36).slice(2, 10)

const MATTERS = new Set<MatterType>([
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
])

const JURISDICTIONS = new Set<Jurisdiction>([
  'EnglandWales',
  'Scotland',
  'NorthernIreland',
  'Unknown',
])

function asMatter(value?: string): MatterType | undefined {
  if (!value) return undefined
  return MATTERS.has(value as MatterType) ? (value as MatterType) : undefined
}

function asJurisdiction(value?: string): Jurisdiction | undefined {
  if (!value) return undefined
  return JURISDICTIONS.has(value as Jurisdiction) ? (value as Jurisdiction) : undefined
}

/** Merge LLM-compiled timeline into session (prefer LLM events when rich). */
export function mergeOrchestratedTimeline(
  session: SessionState,
  timeline: OrchestrateTimeline,
): SessionState {
  const llmEvents: TimelineEvent[] = (timeline.events || [])
    .filter((e) => (e.label || e.rawSpan || '').trim().length >= 8)
    .map((e) => ({
      id: uid(),
      kind: 'event' as const,
      label: e.label.trim().slice(0, 78),
      rawSpan: e.rawSpan?.trim() || e.label.trim(),
      dateApprox: e.dateApprox?.trim() || undefined,
    }))

  const useLlmEvents = llmEvents.length >= 2
  const events = useLlmEvents ? llmEvents : session.events

  const parties: Party[] = [...session.parties]
  for (const p of timeline.parties || []) {
    if (!p.label) continue
    if (parties.some((x) => x.label.toLowerCase() === p.label.toLowerCase())) continue
    parties.push({ label: p.label, role: p.role })
  }

  const documents = [...session.documents]
  for (const d of timeline.documents || []) {
    if (!d || documents.includes(d)) continue
    documents.push(d)
  }

  const matterType = asMatter(timeline.matterType)
  const jurisdiction = asJurisdiction(timeline.jurisdiction)
  const mode =
    timeline.mode === 'info' ||
    timeline.mode === 'dispute' ||
    timeline.mode === 'browse' ||
    timeline.mode === 'urgent'
      ? (timeline.mode as Mode)
      : undefined

  return sanitizeIntakeNarrative({
    ...session,
    events,
    whatHappened:
      timeline.whatHappened?.trim().length >= 40
        ? timeline.whatHappened.trim()
        : session.whatHappened || timeline.whatHappened || '',
    howCaused: timeline.howCaused?.trim() || session.howCaused,
    goal: timeline.goal?.trim() || session.goal,
    parties,
    documents,
    // LLM classification wins when it names a real matter
    matterType:
      matterType && matterType !== 'unknown'
        ? matterType
        : session.matterType !== 'unknown'
          ? session.matterType
          : matterType || session.matterType,
    mode: mode || session.mode,
    jurisdiction:
      jurisdiction && jurisdiction !== 'Unknown'
        ? jurisdiction
        : session.jurisdiction !== 'Unknown'
          ? session.jurisdiction
          : jurisdiction || session.jurisdiction,
    locationHint: timeline.locationHint?.trim() || session.locationHint,
    briefUnderstanding:
      (timeline as { understanding?: string }).understanding?.trim() || session.briefUnderstanding,
    clientQuestion:
      (timeline as { clientQuestion?: string }).clientQuestion?.trim() || session.clientQuestion,
    topicId: (timeline as { topicId?: string }).topicId?.trim() || session.topicId,
  })
}

export function clarifiersForSession(session: SessionState) {
  const frames = proposeLegalFrames(session, 5)
  const pass = maximiseLocalCoherence(session, frames, [], 3)
  return {
    clarifiers: pass.clarifierSuggestions,
    frameIds: frames.map((f) => f.id),
  }
}

/**
 * Call Vite /api/llm/orchestrate — timeline compile + knowledge retrieve + next ask.
 */
export async function orchestrateWithLlm(
  session: SessionState,
  latestText: string,
  heuristicPrompt: Prompt | null,
  signal?: AbortSignal,
): Promise<OrchestrateResult | null> {
  if (!latestText.trim()) return null

  const { clarifiers, frameIds } = clarifiersForSession(session)

  try {
    const res = await fetch('/api/coherence/llm/orchestrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latestText,
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
          events: session.events.map((e) => ({
            label: e.label,
            rawSpan: e.rawSpan,
            dateApprox: e.dateApprox,
          })),
          rawInputs: session.rawInputs.slice(-4),
          answeredPromptIds: session.answeredPromptIds,
          softFlags: session.softFlags,
        },
        clarifiers,
        frameIds,
        heuristicPrompt: heuristicPrompt
          ? { id: heuristicPrompt.id, text: heuristicPrompt.text, reason: heuristicPrompt.reason }
          : null,
      }),
      signal,
    })

    const data = (await res.json()) as OrchestrateResult & { error?: string; fallback?: boolean }
    if (!res.ok || !data.timeline) return null
    return {
      timeline: data.timeline,
      snippets: data.snippets || [],
      prompt: data.prompt,
      model: data.model,
    }
  } catch {
    return null
  }
}
