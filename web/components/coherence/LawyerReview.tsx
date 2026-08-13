import { useState } from 'react'
import type {
  EditMark,
  FieldCorrection,
  LawyerReviewRecord,
} from '@/lib/coherence/lawyerLoop'
import { setFieldMark } from '@/lib/coherence/lawyerLoop'
import './LawyerReview.css'

interface Props {
  review: LawyerReviewRecord
  onChange: (next: LawyerReviewRecord) => void
}

const MARKS: { mark: Exclude<EditMark, 'pending'>; label: string }[] = [
  { mark: 'accepted', label: 'Accept' },
  { mark: 'edited', label: 'Edit' },
  { mark: 'rejected', label: 'Reject' },
]

function kindLabel(kind: FieldCorrection['kind']): string {
  switch (kind) {
    case 'issue':
      return 'Frame'
    case 'timeline_event':
      return 'Fact'
    case 'client_goal':
      return 'Goal'
    case 'matter_summary':
      return 'Summary'
    case 'conflict':
      return 'Conflict'
    case 'candidate_source':
      return 'Source'
    case 'open_question':
      return 'Question'
    default:
      return kind
  }
}

/** Primary review targets: classifications + core facts (moat). Sources/conflicts secondary. */
function isPrimary(c: FieldCorrection): boolean {
  return (
    c.kind === 'issue' ||
    c.kind === 'timeline_event' ||
    c.kind === 'client_goal' ||
    c.kind === 'matter_summary'
  )
}

export function LawyerReview({ review, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showSecondary, setShowSecondary] = useState(false)

  const primary = review.corrections.filter(isPrimary)
  const secondary = review.corrections.filter((c) => !isPrimary(c))
  const { summary } = review

  function applyMark(fieldId: string, mark: Exclude<EditMark, 'pending'>, proposed: string) {
    if (mark === 'edited') {
      setEditingId(fieldId)
      setDraft(proposed)
      return
    }
    setEditingId(null)
    onChange(setFieldMark(review, fieldId, mark))
  }

  function commitEdit(fieldId: string) {
    const value = draft.trim()
    if (!value) return
    setEditingId(null)
    onChange(setFieldMark(review, fieldId, 'edited', { final_value: value }))
  }

  function renderRow(c: FieldCorrection) {
    const isEditing = editingId === c.field_id
    return (
      <li key={c.field_id} className={`review__row review__row--${c.mark}`}>
        <div className="review__meta">
          <span className="review__kind">{kindLabel(c.kind)}</span>
          <span className={`review__mark review__mark--${c.mark}`}>{c.mark}</span>
        </div>
        {isEditing ? (
          <div className="review__edit">
            <textarea
              className="review__textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              aria-label={`Edit ${kindLabel(c.kind)}`}
            />
            <div className="review__edit-actions">
              <button type="button" className="review__btn review__btn--solid" onClick={() => commitEdit(c.field_id)}>
                Save edit
              </button>
              <button
                type="button"
                className="review__btn"
                onClick={() => {
                  setEditingId(null)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="review__value">
            {c.mark === 'rejected' ? (
              <span className="review__struck">{c.proposed_value}</span>
            ) : c.mark === 'edited' ? (
              <>
                <span className="review__struck">{c.proposed_value}</span>
                <span className="review__final">{c.final_value}</span>
              </>
            ) : (
              c.proposed_value
            )}
          </p>
        )}
        <div className="review__actions" role="group" aria-label={`Review ${kindLabel(c.kind)}`}>
          {MARKS.map(({ mark, label }) => (
            <button
              key={mark}
              type="button"
              className={`review__btn${c.mark === mark ? ' review__btn--active' : ''}`}
              onClick={() => applyMark(c.field_id, mark, c.proposed_value)}
            >
              {label}
            </button>
          ))}
        </div>
      </li>
    )
  }

  return (
    <section className="review no-print" aria-label="Lawyer review">
      <header className="review__header">
        <div>
          <h2 className="review__title">Lawyer review</h2>
          <p className="review__lead">
            Accept, edit, or reject classifications and facts. Corrections become gold for the Phase 4
            moat.
          </p>
        </div>
        <dl className="review__stats">
          <div>
            <dt>Accepted</dt>
            <dd>{summary.accepted}</dd>
          </div>
          <div>
            <dt>Edited</dt>
            <dd>{summary.edited}</dd>
          </div>
          <div>
            <dt>Rejected</dt>
            <dd>{summary.rejected}</dd>
          </div>
          <div>
            <dt>Edit distance</dt>
            <dd>{summary.edit_distance.toFixed(2)}</dd>
          </div>
        </dl>
      </header>

      <ul className="review__list">{primary.map(renderRow)}</ul>

      {secondary.length > 0 && (
        <div className="review__secondary">
          <button
            type="button"
            className="review__toggle"
            onClick={() => setShowSecondary((v) => !v)}
            aria-expanded={showSecondary}
          >
            {showSecondary ? 'Hide' : 'Show'} wiki sources & conflicts ({secondary.length})
          </button>
          {showSecondary && <ul className="review__list">{secondary.map(renderRow)}</ul>}
        </div>
      )}
    </section>
  )
}
