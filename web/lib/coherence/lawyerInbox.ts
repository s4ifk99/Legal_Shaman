/**
 * Lawyer handoff inbox — briefs queued for signed-in solicitors (Phase 4).
 * Clients never browse this; they only push a share (or lawyers import JSON).
 */

import type { SolicitorBriefV0 } from './briefSchema'
import type { SolicitorBriefWithReview } from './lawyerLoop'

const INBOX_KEY = 'coherence-intake-lawyer-inbox-v1'

export type HandoffInboxItem = {
  id: string
  queued_at: string
  brief: SolicitorBriefV0 | SolicitorBriefWithReview
  source: 'client_share' | 'import' | 'live_session'
  label: string
}

export type HandoffInbox = {
  schema_version: 'c1.lawyer_inbox.v0'
  updated_at: string
  items: HandoffInboxItem[]
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `handoff-${Date.now()}`
}

export function emptyInbox(): HandoffInbox {
  return { schema_version: 'c1.lawyer_inbox.v0', updated_at: nowIso(), items: [] }
}

export function loadInbox(): HandoffInbox {
  try {
    const raw = localStorage.getItem(INBOX_KEY)
    if (!raw) return emptyInbox()
    const data = JSON.parse(raw) as HandoffInbox
    if (!data || !Array.isArray(data.items)) return emptyInbox()
    return data
  } catch {
    return emptyInbox()
  }
}

export function saveInbox(inbox: HandoffInbox) {
  try {
    localStorage.setItem(INBOX_KEY, JSON.stringify(inbox))
  } catch {
    // quota
  }
}

export function queueHandoff(
  brief: SolicitorBriefV0 | SolicitorBriefWithReview,
  source: HandoffInboxItem['source'],
  label?: string,
): HandoffInbox {
  const inbox = loadInbox()
  const item: HandoffInboxItem = {
    id: newId(),
    queued_at: nowIso(),
    brief,
    source,
    label:
      label ||
      brief.client_goal?.stated?.slice(0, 72) ||
      brief.matter_summary_plain?.slice(0, 72) ||
      brief.brief_id,
  }
  // Dedupe by brief_id — newest wins
  const items = [item, ...inbox.items.filter((i) => i.brief.brief_id !== brief.brief_id)]
  const next = { schema_version: 'c1.lawyer_inbox.v0' as const, updated_at: nowIso(), items }
  saveInbox(next)
  return next
}

export function removeHandoff(id: string): HandoffInbox {
  const inbox = loadInbox()
  const next = {
    ...inbox,
    updated_at: nowIso(),
    items: inbox.items.filter((i) => i.id !== id),
  }
  saveInbox(next)
  return next
}

export function parseBriefJson(raw: string): SolicitorBriefV0 | null {
  try {
    const data = JSON.parse(raw) as SolicitorBriefV0
    if (!data || data.schema_version !== 'c1.brief.v0') return null
    if (!data.brief_id || !Array.isArray(data.issues)) return null
    return data
  } catch {
    return null
  }
}
