/**
 * Client Brief Agent — understands the live brief and builds timeline (LLM + heuristics).
 */
import type { MatterType, Mode, Party, SessionState, TimelineEvent, Jurisdiction } from './types'
import { createInitialSession } from './sense'

export type BriefResult = {
  freshBrief: boolean
  topicId: string
  understanding: string
  clientQuestion: string
  matterType: string
  matterConfidence?: number
  frameHints?: string[]
  goal?: string
  mode?: string
  events: { label: string; rawSpan: string; dateApprox?: string; actors?: string[] }[]
  whatHappened: string
  parties?: Party[]
  documents?: string[]
  jurisdiction?: string
  locationHint?: string
  howCaused?: string
  openUncertainties?: { id: string; whyItMatters: string; suggestedAsk: string }[]
  source?: string
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

function asMatter(value?: string): MatterType {
  if (value && MATTERS.has(value as MatterType)) return value as MatterType
  return 'unknown'
}

function asJurisdiction(value?: string): Jurisdiction {
  if (value && JURISDICTIONS.has(value as Jurisdiction)) return value as Jurisdiction
  return 'Unknown'
}

/** Call /api/llm/brief — always returns heuristic fallback if LLM down. */
export async function understandBrief(
  session: SessionState,
  latestText: string,
  signal?: AbortSignal,
): Promise<BriefResult | null> {
  if (!latestText.trim()) return null
  try {
    const res = await fetch('/api/coherence/llm/brief', {
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
          topicId: session.topicId,
        },
      }),
      signal,
    })
    const data = (await res.json()) as BriefResult & { error?: string }
    if (!res.ok || !data?.events?.length) return null
    return data
  } catch {
    return null
  }
}

/**
 * Apply brief agent result into session.
 * When freshBrief, replaces prior narrative (clears stale car/CRA state).
 */
export function applyBriefToSession(
  session: SessionState,
  brief: BriefResult,
  latestText: string,
): SessionState {
  const base: SessionState = brief.freshBrief
    ? {
        ...createInitialSession(),
        mode:
          session.mode !== 'unknown'
            ? session.mode
            : brief.mode === 'dispute' ||
                brief.mode === 'info' ||
                brief.mode === 'browse' ||
                brief.mode === 'urgent'
              ? (brief.mode as Mode)
              : 'dispute',
        answeredPromptIds: session.answeredPromptIds.includes('mode_fork')
          ? ['mode_fork']
          : session.answeredPromptIds.filter((id) => id === 'mode_fork'),
      }
    : { ...session }

  const events: TimelineEvent[] = (brief.events || []).map((e) => ({
    id: uid(),
    kind: 'event' as const,
    label: e.label.trim().slice(0, 78),
    rawSpan: e.rawSpan?.trim() || e.label.trim(),
    dateApprox: e.dateApprox?.trim() || undefined,
  }))

  const parties: Party[] = brief.freshBrief ? [] : [...base.parties]
  for (const p of brief.parties || []) {
    if (!p.label) continue
    if (parties.some((x) => x.label.toLowerCase() === p.label.toLowerCase())) continue
    parties.push({ label: p.label, role: p.role })
  }

  const documents = brief.freshBrief ? [...(brief.documents || [])] : [...base.documents]
  for (const d of brief.documents || []) {
    if (!d || documents.includes(d)) continue
    documents.push(d)
  }

  const matter = asMatter(brief.matterType)
  const jurisdiction = asJurisdiction(brief.jurisdiction)

  return {
    ...base,
    rawInputs: brief.freshBrief ? [latestText] : [...base.rawInputs, latestText].filter(Boolean),
    events: events.length >= 2 ? events : base.events,
    whatHappened: brief.whatHappened?.trim() || latestText,
    howCaused: brief.howCaused?.trim() || (brief.freshBrief ? '' : base.howCaused),
    goal: brief.goal?.trim() || base.goal,
    parties,
    documents,
    matterType: matter !== 'unknown' ? matter : base.matterType,
    jurisdiction: jurisdiction !== 'Unknown' ? jurisdiction : base.jurisdiction,
    locationHint: brief.locationHint?.trim() || base.locationHint,
    mode:
      brief.mode === 'info' ||
      brief.mode === 'dispute' ||
      brief.mode === 'browse' ||
      brief.mode === 'urgent'
        ? (brief.mode as Mode)
        : base.mode,
    briefUnderstanding: brief.understanding || '',
    clientQuestion: brief.clientQuestion || '',
    topicId: brief.topicId || '',
  }
}
