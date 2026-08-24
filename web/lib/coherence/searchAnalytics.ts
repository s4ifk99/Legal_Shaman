/**
 * T4 — intent-conditioned search analytics.
 * Consumes session.abPrimaryMetric (not write-only): tags which events
 * count as success signals under Shao-style intent metrics.
 */

import type { SessionState } from './types'

const STORAGE_KEY = 'coherence-search-analytics-v1'
const MAX_EVENTS = 400

export type SearchView = 'services' | 'oslaw' | 'intake'

export type SearchEventType =
  | 'impression'
  | 'click'
  | 'dwell'
  | 'frame_confirm'
  | 'step_click'

export interface SearchAnalyticsEvent {
  at: string
  view: SearchView
  type: SearchEventType
  searchIntent: SessionState['searchIntent']
  abPrimaryMetric: SessionState['abPrimaryMetric']
  /** Whether this event type is a success signal for the session's primary metric */
  countsTowardMetric: boolean
  resultIds?: string[]
  resultId?: string
  dwellMs?: number
  frameId?: string
  meta?: Record<string, string | number | boolean>
}

/** Which event types feed the primary AB metric (Shao-adapted). */
export function eventTypesForMetric(
  metric: SessionState['abPrimaryMetric'],
): SearchEventType[] {
  switch (metric) {
    case 'precision_at_k':
      return ['click']
    case 'guidance_step_engagement':
      return ['dwell', 'step_click']
    case 'frame_confirm_rate':
      return ['frame_confirm']
    case 'task_completion':
      return ['click', 'step_click']
    case 'session_depth':
      return ['impression', 'click', 'dwell']
    default:
      return ['click', 'dwell', 'frame_confirm']
  }
}

export function countsTowardPrimaryMetric(
  metric: SessionState['abPrimaryMetric'],
  type: SearchEventType,
): boolean {
  return eventTypesForMetric(metric).includes(type)
}

function readStore(): SearchAnalyticsEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SearchAnalyticsEvent[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStore(events: SearchAnalyticsEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)))
  } catch {
    /* quota / private mode */
  }
}

/** Append a search analytics event; always records abPrimaryMetric from session. */
export function logSearchEvent(
  session: SessionState,
  partial: Omit<
    SearchAnalyticsEvent,
    'at' | 'searchIntent' | 'abPrimaryMetric' | 'countsTowardMetric'
  >,
): SearchAnalyticsEvent {
  const metric = session.abPrimaryMetric ?? 'unset'
  const event: SearchAnalyticsEvent = {
    ...partial,
    at: new Date().toISOString(),
    searchIntent: session.searchIntent ?? 'unknown',
    abPrimaryMetric: metric,
    countsTowardMetric: countsTowardPrimaryMetric(metric, partial.type),
  }
  const next = [...readStore(), event]
  writeStore(next)
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.debug('[search-analytics]', event.type, {
      metric: event.abPrimaryMetric,
      intent: event.searchIntent,
      counts: event.countsTowardMetric,
      resultId: event.resultId,
      dwellMs: event.dwellMs,
      frameId: event.frameId,
    })
  }
  return event
}

export function getSearchAnalyticsEvents(): SearchAnalyticsEvent[] {
  return readStore()
}

export function clearSearchAnalytics() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Aggregate success-signal rates by primary metric (for local dashboards). */
export function summarizeAnalyticsByMetric(): Record<
  string,
  { n: number; successSignals: number; impressions: number }
> {
  const events = readStore()
  const out: Record<string, { n: number; successSignals: number; impressions: number }> = {}
  for (const e of events) {
    const key = e.abPrimaryMetric || 'unset'
    if (!out[key]) out[key] = { n: 0, successSignals: 0, impressions: 0 }
    out[key].n += 1
    if (e.countsTowardMetric && e.type !== 'impression') out[key].successSignals += 1
    if (e.type === 'impression') out[key].impressions += 1
  }
  return out
}
