/**
 * Client Master Orchestrator — subagents + critic via /api/llm/master
 */
import type { MatterType, Mode, Party, Prompt, SessionState, TimelineEvent, Jurisdiction } from './types'
import { createInitialSession } from './sense'
import type { AnswerPackage } from './answerPackage'
import type { SessionMatterFrame } from './matterFrame'
import { coherenceMasterEndpoint } from '@/lib/coherence/client-gateway'

export type MasterResult = {
  runId?: string
  finalOk?: boolean
  brief?: {
    freshBrief?: boolean
    topicId?: string
    understanding?: string
    clientQuestion?: string
    matterType?: string
    goal?: string
    mode?: string
    events?: { label: string; rawSpan: string; dateApprox?: string }[]
    whatHappened?: string
    parties?: Party[]
    documents?: string[]
    jurisdiction?: string
    locationHint?: string
    howCaused?: string
    openUncertainties?: { id: string; whyItMatters: string; suggestedAsk: string }[]
  }
  classify?: {
    matterType?: string
    topicId?: string
    frameHints?: string[]
    taxonomySlug?: string
  }
  ask?: Prompt | null
  answerPackage?: AnswerPackage | null
  helpMatch?: HelpMatchResult | null
  matterFrame?: SessionMatterFrame | null
  matterInspector?: {
    matterId: string
    primary: { slug: string; confidence: number; reason: string }[]
    secondary: { slug: string; confidence: number }[]
    excluded: string[]
    ambiguities: string[]
    retrievalScope: string[]
    overallConfidence: number
    text: string
  } | null
  critiques?: { step: string; ok: boolean; errors?: string[]; critique?: string }[]
  error?: string
  message?: string
  fallback?: boolean
}

export type HelpMatchHit = {
  id: string
  title: string
  type: string
  blurb: string
  url?: string
  phone?: string
  tier?: string
  group?: string
  sraId?: string
  articleCount?: number
}

export type HelpMatchResult = {
  agent?: string
  policy: string
  topicId?: string
  matterType?: string
  taxonomySlug?: string | null
  freeHelp: HelpMatchHit[]
  signposts: HelpMatchHit[]
  directories: HelpMatchHit[]
  solicitors: HelpMatchHit[]
  ranked: HelpMatchHit[]
  sra?: {
    configured?: boolean
    reachable?: boolean
    total?: number
    hitCount?: number
    error?: string | null
  }
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

export async function runMasterOrchestrate(
  session: SessionState,
  latestText: string,
  heuristicPrompt: Prompt | null,
  signal?: AbortSignal,
  mode: 'intake' | 'answer' = 'intake',
): Promise<MasterResult | null> {
  if (!latestText.trim()) return null
  const endpoint = coherenceMasterEndpoint()
  const requestId = `coh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': requestId,
        'x-idempotency-key': requestId,
      },
      body: JSON.stringify({
        latestText,
        mode,
        heuristicPrompt: heuristicPrompt
          ? { id: heuristicPrompt.id, text: heuristicPrompt.text, reason: heuristicPrompt.reason }
          : null,
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
          answeredPromptIds: session.answeredPromptIds,
        },
      }),
      signal,
    })
    const data = (await res.json()) as MasterResult
    if (!res.ok) {
      if (res.status === 503 && endpoint === '/api/coherence/query') {
        return {
          error: String(data.error || 'backend_unavailable'),
          message:
            typeof (data as { message?: string }).message === 'string'
              ? (data as { message?: string }).message
              : 'Legal Shaman analysis is temporarily unavailable. Your submission has been saved. Please try again shortly.',
          fallback: true,
        }
      }
      return {
        error: String(data.error || 'request_failed'),
        message:
          typeof (data as { message?: string }).message === 'string'
            ? (data as { message?: string }).message
            : undefined,
        fallback: data.fallback,
      }
    }
    if (!data?.brief) return null
    return data
  } catch {
    return null
  }
}

/** Apply master result into session (fresh brief replaces stale narrative). */
export function applyMasterToSession(
  session: SessionState,
  master: MasterResult,
  latestText: string,
): SessionState {
  const brief = master.brief || {}
  const classify = master.classify || {}
  const fresh = Boolean(brief.freshBrief)

  const base: SessionState = fresh
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
    label: (e.label || '').trim().slice(0, 78),
    rawSpan: e.rawSpan?.trim() || e.label?.trim() || '',
    dateApprox: e.dateApprox?.trim() || undefined,
  }))

  const parties: Party[] = fresh ? [] : [...base.parties]
  for (const p of brief.parties || []) {
    if (!p.label) continue
    if (parties.some((x) => x.label.toLowerCase() === p.label.toLowerCase())) continue
    parties.push({ label: p.label, role: p.role })
  }

  const matter = asMatter(classify.matterType || brief.matterType)
  const jurisdiction = asJurisdiction(brief.jurisdiction)

  const briefWhat = brief.whatHappened?.trim() || ''
  const baseWhat = base.whatHappened?.trim() || ''
  const latest = latestText.trim()
  // Never replace a long client story with a short clarifier or location chip
  const preferStory = (...opts: string[]) =>
    opts
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || ''

  const rawInputs = fresh
    ? [latest].filter(Boolean)
    : base.rawInputs[base.rawInputs.length - 1] === latest
      ? base.rawInputs
      : [...base.rawInputs, latest].filter(Boolean)

  return {
    ...base,
    rawInputs,
    events: events.length >= 2 ? events : base.events,
    whatHappened: preferStory(briefWhat, baseWhat, latest.length >= 40 ? latest : ''),
    howCaused: brief.howCaused?.trim() || (fresh ? '' : base.howCaused),
    goal: brief.goal?.trim() || base.goal,
    parties,
    documents: fresh ? [...(brief.documents || [])] : base.documents,
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
    briefUnderstanding: brief.understanding?.trim() || base.briefUnderstanding || '',
    clientQuestion: brief.clientQuestion?.trim() || base.clientQuestion || '',
    topicId: classify.topicId || brief.topicId || '',
    taxonomySlug: classify.taxonomySlug || base.taxonomySlug || null,
    matterFrame: master.matterFrame ?? base.matterFrame ?? null,
  }
}
