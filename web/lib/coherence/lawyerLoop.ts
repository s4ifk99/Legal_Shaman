/**
 * Phase 4 — Lawyer-in-the-loop moat.
 *
 * Solicitors accept / edit / reject classifications (frames, facts, goal)
 * produced by Phase 0–3. Corrections become training/eval gold.
 * Exit metric: measurable drop in edit-distance on briefs over time.
 */

import type { SolicitorBriefV0 } from './briefSchema'

export type EditMark = 'accepted' | 'edited' | 'rejected' | 'pending'

export type ReviewFieldKind =
  | 'issue'
  | 'timeline_event'
  | 'client_goal'
  | 'matter_summary'
  | 'conflict'
  | 'candidate_source'
  | 'open_question'

export interface FieldCorrection {
  field_id: string
  kind: ReviewFieldKind
  mark: EditMark
  /** What Phase 0–3 proposed */
  proposed_value: string
  /** What the solicitor kept (empty when rejected) */
  final_value: string
  note?: string
  reviewed_at?: string
}

export interface LawyerReviewSummary {
  total: number
  accepted: number
  edited: number
  rejected: number
  pending: number
  /**
   * 0 = no solicitor touch needed (all accepted).
   * 1 = every field edited or rejected.
   * Pending fields are ignored in the denominator.
   */
  edit_distance: number
}

export interface LawyerReviewRecord {
  schema_version: 'c1.lawyer_review.v0'
  brief_id: string
  created_at: string
  updated_at: string
  corrections: FieldCorrection[]
  summary: LawyerReviewSummary
}

/** Brief export with optional Phase 4 review attached (schema stays v0 + soft extension). */
export type SolicitorBriefWithReview = SolicitorBriefV0 & {
  lawyer_review?: LawyerReviewRecord
}

const GOLD_KEY = 'coherence-intake-lawyer-gold-v1'

export function computeReviewSummary(corrections: FieldCorrection[]): LawyerReviewSummary {
  const summary: LawyerReviewSummary = {
    total: corrections.length,
    accepted: 0,
    edited: 0,
    rejected: 0,
    pending: 0,
    edit_distance: 0,
  }
  for (const c of corrections) {
    if (c.mark === 'accepted') summary.accepted++
    else if (c.mark === 'edited') summary.edited++
    else if (c.mark === 'rejected') summary.rejected++
    else summary.pending++
  }
  const decided = summary.accepted + summary.edited + summary.rejected
  summary.edit_distance =
    decided === 0 ? 0 : (summary.edited + summary.rejected) / decided
  return summary
}

function nowIso() {
  return new Date().toISOString()
}

/** Seed pending review rows from a Phase 0 brief (already filled by Phase 1–3). */
export function seedReviewFromBrief(brief: SolicitorBriefV0): LawyerReviewRecord {
  const corrections: FieldCorrection[] = []

  corrections.push({
    field_id: 'client_goal',
    kind: 'client_goal',
    mark: 'pending',
    proposed_value: brief.client_goal.stated,
    final_value: brief.client_goal.stated,
  })

  corrections.push({
    field_id: 'matter_summary',
    kind: 'matter_summary',
    mark: 'pending',
    proposed_value: brief.matter_summary_plain,
    final_value: brief.matter_summary_plain,
  })

  for (const row of brief.timeline) {
    corrections.push({
      field_id: `timeline:${row.order}`,
      kind: 'timeline_event',
      mark: 'pending',
      proposed_value: row.event,
      final_value: row.event,
    })
  }

  for (const issue of brief.issues) {
    const proposed = `${issue.plain_label} — ${issue.why_this_frame.join('; ')}`
    corrections.push({
      field_id: `issue:${issue.id}`,
      kind: 'issue',
      mark: 'pending',
      proposed_value: proposed,
      final_value: proposed,
    })
  }

  for (const [i, c] of brief.conflicts_detected.entries()) {
    corrections.push({
      field_id: `conflict:${i}`,
      kind: 'conflict',
      mark: 'pending',
      proposed_value: c.description,
      final_value: c.description,
    })
  }

  for (const issue of brief.issues) {
    for (const [si, src] of issue.candidate_sources.entries()) {
      corrections.push({
        field_id: `source:${issue.id}:${si}`,
        kind: 'candidate_source',
        mark: 'pending',
        proposed_value: `${src.title} (${src.url_or_id})`,
        final_value: `${src.title} (${src.url_or_id})`,
      })
    }
  }

  const created = nowIso()
  return {
    schema_version: 'c1.lawyer_review.v0',
    brief_id: brief.brief_id,
    created_at: created,
    updated_at: created,
    corrections,
    summary: computeReviewSummary(corrections),
  }
}

export function setFieldMark(
  review: LawyerReviewRecord,
  fieldId: string,
  mark: EditMark,
  opts?: { final_value?: string; note?: string },
): LawyerReviewRecord {
  const corrections = review.corrections.map((c) => {
    if (c.field_id !== fieldId) return c
    const final_value =
      mark === 'rejected'
        ? ''
        : opts?.final_value !== undefined
          ? opts.final_value
          : mark === 'accepted'
            ? c.proposed_value
            : c.final_value || c.proposed_value
    return {
      ...c,
      mark,
      final_value,
      note: opts?.note ?? c.note,
      reviewed_at: nowIso(),
    }
  })
  return {
    ...review,
    updated_at: nowIso(),
    corrections,
    summary: computeReviewSummary(corrections),
  }
}

/**
 * Apply solicitor marks onto the Phase 0 brief for handoff.
 * Rejected issues / conflicts / sources are dropped; edited text replaces proposals.
 */
export function applyReviewToBrief(
  brief: SolicitorBriefV0,
  review: LawyerReviewRecord,
): SolicitorBriefWithReview {
  const byId = new Map(review.corrections.map((c) => [c.field_id, c]))

  const goalMark = byId.get('client_goal')
  const summaryMark = byId.get('matter_summary')

  const timeline = brief.timeline
    .map((row) => {
      const mark = byId.get(`timeline:${row.order}`)
      if (!mark || mark.mark === 'pending' || mark.mark === 'accepted') return row
      if (mark.mark === 'rejected') return null
      return { ...row, event: mark.final_value || row.event }
    })
    .filter((r): r is SolicitorBriefV0['timeline'][number] => r !== null)
    .map((row, i) => ({ ...row, order: i + 1 }))

  const issues = brief.issues
    .map((issue) => {
      const mark = byId.get(`issue:${issue.id}`)
      if (mark?.mark === 'rejected') return null
      let next = { ...issue }
      if (mark?.mark === 'edited' && mark.final_value) {
        const parts = mark.final_value.split(' — ')
        next = {
          ...next,
          plain_label: parts[0]?.trim() || issue.plain_label,
          why_this_frame: parts.slice(1).join(' — ').trim()
            ? [parts.slice(1).join(' — ').trim()]
            : issue.why_this_frame,
        }
      }
      const sources = issue.candidate_sources.filter((_, si) => {
        const sm = byId.get(`source:${issue.id}:${si}`)
        return !sm || sm.mark !== 'rejected'
      })
      return { ...next, candidate_sources: sources }
    })
    .filter((i): i is SolicitorBriefV0['issues'][number] => i !== null)
    .map((issue, i) => ({
      ...issue,
      rank: i === 0 ? ('primary' as const) : ('alternative' as const),
    }))

  const conflicts_detected = brief.conflicts_detected
    .map((c, i) => {
      const mark = byId.get(`conflict:${i}`)
      if (mark?.mark === 'rejected') return null
      if (mark?.mark === 'edited' && mark.final_value) {
        return { ...c, description: mark.final_value }
      }
      return c
    })
    .filter((c): c is SolicitorBriefV0['conflicts_detected'][number] => c !== null)

  return {
    ...brief,
    client_goal: {
      ...brief.client_goal,
      stated: goalMark?.mark === 'edited' && goalMark.final_value
        ? goalMark.final_value
        : brief.client_goal.stated,
    },
    matter_summary_plain:
      summaryMark?.mark === 'edited' && summaryMark.final_value
        ? summaryMark.final_value
        : brief.matter_summary_plain,
    timeline,
    issues,
    conflicts_detected,
    lawyer_review: {
      ...review,
      brief_id: brief.brief_id,
      summary: computeReviewSummary(review.corrections),
    },
  }
}

/** Gold row for training / eval — proposed vs solicitor final. */
export interface GoldCorrectionRow {
  brief_id: string
  field_id: string
  kind: ReviewFieldKind
  mark: Exclude<EditMark, 'pending'>
  proposed_value: string
  final_value: string
  note?: string
  captured_at: string
}

export function extractGoldRows(review: LawyerReviewRecord): GoldCorrectionRow[] {
  const captured_at = nowIso()
  return review.corrections
    .filter((c): c is FieldCorrection & { mark: Exclude<EditMark, 'pending'> } =>
      c.mark === 'accepted' || c.mark === 'edited' || c.mark === 'rejected',
    )
    .map((c) => ({
      brief_id: review.brief_id,
      field_id: c.field_id,
      kind: c.kind,
      mark: c.mark,
      proposed_value: c.proposed_value,
      final_value: c.final_value,
      note: c.note,
      captured_at,
    }))
}

export type GoldStore = {
  schema_version: 'c1.lawyer_gold.v0'
  updated_at: string
  rows: GoldCorrectionRow[]
}

export function emptyGoldStore(): GoldStore {
  return { schema_version: 'c1.lawyer_gold.v0', updated_at: nowIso(), rows: [] }
}

export function mergeGoldRows(store: GoldStore, rows: GoldCorrectionRow[]): GoldStore {
  const key = (r: GoldCorrectionRow) => `${r.brief_id}::${r.field_id}`
  const map = new Map(store.rows.map((r) => [key(r), r]))
  for (const row of rows) map.set(key(row), row)
  return {
    schema_version: 'c1.lawyer_gold.v0',
    updated_at: nowIso(),
    rows: [...map.values()],
  }
}

/** Rolling edit-distance across decided gold marks (Phase 4 exit signal). */
export function goldEditDistance(store: GoldStore): number {
  if (store.rows.length === 0) return 0
  const touched = store.rows.filter((r) => r.mark === 'edited' || r.mark === 'rejected').length
  return touched / store.rows.length
}

export function loadGoldStore(): GoldStore {
  try {
    const raw = localStorage.getItem(GOLD_KEY)
    if (!raw) return emptyGoldStore()
    const data = JSON.parse(raw) as GoldStore
    if (!data || !Array.isArray(data.rows)) return emptyGoldStore()
    return data
  } catch {
    return emptyGoldStore()
  }
}

export function saveGoldStore(store: GoldStore) {
  try {
    localStorage.setItem(GOLD_KEY, JSON.stringify(store))
  } catch {
    // quota / private mode
  }
}

export function persistReviewAsGold(review: LawyerReviewRecord): GoldStore {
  const next = mergeGoldRows(loadGoldStore(), extractGoldRows(review))
  saveGoldStore(next)
  return next
}

export function reviewToJsonDownload(review: LawyerReviewRecord): string {
  return JSON.stringify(review, null, 2)
}

export function goldToJsonDownload(store: GoldStore): string {
  return JSON.stringify(store, null, 2)
}

export function validateLawyerReviewShape(review: unknown): string[] {
  const errors: string[] = []
  if (!review || typeof review !== 'object') return ['review is not an object']
  const r = review as Record<string, unknown>
  if (r.schema_version !== 'c1.lawyer_review.v0') {
    errors.push('schema_version must be c1.lawyer_review.v0')
  }
  if (typeof r.brief_id !== 'string' || !r.brief_id) errors.push('brief_id required')
  if (!Array.isArray(r.corrections)) errors.push('corrections must be an array')
  else {
    for (const [i, c] of r.corrections.entries()) {
      const row = c as Record<string, unknown>
      if (!row.field_id) errors.push(`corrections[${i}].field_id missing`)
      if (!['accepted', 'edited', 'rejected', 'pending'].includes(String(row.mark))) {
        errors.push(`corrections[${i}].mark invalid`)
      }
    }
  }
  return errors
}
