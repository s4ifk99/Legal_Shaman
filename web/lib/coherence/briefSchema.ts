/**
 * Phase 0 solicitor brief contract (C1 schema v0), immigration-trial scoped.
 * Live intake maps into this shape for JSON handoff + gold fixtures.
 */

import type { Jurisdiction, MatterType } from './types'

export type DatePrecision = 'day' | 'month' | 'year' | 'unknown'
export type IssueRank = 'primary' | 'alternative'
export type SignpostType = 'info' | 'clinic' | 'solicitor' | 'emergency'
export type RiskRouting = 'standard' | 'urgent_human' | 'emergency_services_info'

export interface SolicitorBriefV0 {
  schema_version: 'c1.brief.v0'
  trial_domain: 'immigration'
  brief_id: string
  created_at: string
  model_versions: {
    extractor: string
    ranker: string
    corpus: string
  }
  jurisdiction: Jurisdiction
  jurisdiction_label: string
  client: {
    preferred_name: string
    contact_permission: boolean
    vulnerability_flags: string[]
    communication_needs: string[]
  }
  client_goal: {
    stated: string
    success_looks_like: string
    source: 'client' | 'inferred_unconfirmed'
  }
  timeline: {
    order: number
    date_approx: string
    date_precision: DatePrecision
    event: string
    actors: string[]
    source: 'client'
    client_confirmed: boolean
  }[]
  matter_summary_plain: string
  matter_type: MatterType
  parties: { name_or_label: string; role: string; notes: string }[]
  documents_mentioned: {
    label: string
    status: 'said_to_exist' | 'uploaded' | 'unknown'
  }[]
  issues: {
    id: string
    rank: IssueRank
    frame_label: string
    plain_label: string
    why_this_frame: string[]
    unmet_constraints: string[]
    urgency_flags: string[]
    limitation_flags: string[]
    candidate_sources: {
      title: string
      url_or_id: string
      jurisdiction: string
      snippet: string
    }[]
  }[]
  open_questions: string[]
  clarifiers_asked: { q: string; a: string; asked_at: string }[]
  signposts_shown_to_client: {
    label: string
    type: SignpostType
    url: string
  }[]
  conflicts_detected: {
    description: string
    resolution: 'unresolved' | 'resolved'
    note: string
    timeline_orders: number[]
  }[]
  risk_and_safety: {
    immediate_danger: boolean
    routing: RiskRouting
  }
  handoff: {
    ready_for_solicitor: boolean
    consent_to_share: boolean
    attachments: string[]
  }
  system_boundaries: {
    disclaimer: string
    urgent_help?: string
  }
  /** Display / grading helpers (not in canonical C1 doc but useful for Phase 0 eval) */
  grading?: {
    expected?: 'usable' | 'needs_work' | 'unsafe'
    notes?: string
  }
}

/** Keys every Phase 0 gold brief and live export must carry. */
export const SOLICITOR_BRIEF_REQUIRED_KEYS = [
  'schema_version',
  'trial_domain',
  'brief_id',
  'created_at',
  'model_versions',
  'jurisdiction',
  'client',
  'client_goal',
  'timeline',
  'matter_summary_plain',
  'matter_type',
  'parties',
  'documents_mentioned',
  'issues',
  'open_questions',
  'clarifiers_asked',
  'signposts_shown_to_client',
  'conflicts_detected',
  'risk_and_safety',
  'handoff',
  'system_boundaries',
] as const

export function validateSolicitorBriefShape(brief: unknown): string[] {
  const errors: string[] = []
  if (!brief || typeof brief !== 'object') return ['brief is not an object']
  const b = brief as Record<string, unknown>
  for (const key of SOLICITOR_BRIEF_REQUIRED_KEYS) {
    if (!(key in b)) errors.push(`missing key: ${key}`)
  }
  if (b.schema_version !== 'c1.brief.v0') errors.push('schema_version must be c1.brief.v0')
  if (b.trial_domain !== 'immigration') errors.push('trial_domain must be immigration')
  if (!Array.isArray(b.timeline)) errors.push('timeline must be an array')
  if (!Array.isArray(b.issues)) errors.push('issues must be an array')
  const goal = b.client_goal as { stated?: string } | undefined
  if (!goal || typeof goal.stated !== 'string') errors.push('client_goal.stated required')
  const handoff = b.handoff as { ready_for_solicitor?: boolean } | undefined
  if (!handoff || typeof handoff.ready_for_solicitor !== 'boolean') {
    errors.push('handoff.ready_for_solicitor required')
  }
  const risk = b.risk_and_safety as { routing?: string } | undefined
  if (!risk || !['standard', 'urgent_human', 'emergency_services_info'].includes(String(risk.routing))) {
    errors.push('risk_and_safety.routing invalid')
  }
  return errors
}
