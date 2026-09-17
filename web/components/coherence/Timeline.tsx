import { useEffect, useState } from 'react'
import type { SessionState, TimelineEvent } from '@/lib/coherence/types'
import { guessDatePrecision, parseActorList } from '@/lib/coherence/timelineDates'
import './Timeline.css'

type EventPatch = Partial<
  Pick<
    TimelineEvent,
    'label' | 'dateApprox' | 'datePrecision' | 'actors' | 'documentLabels' | 'clientConfirmed' | 'rawSpan'
  >
>

interface Props {
  session: SessionState
  activeId?: string
  banners?: string[]
  onSelect?: (id: string | undefined) => void
  onUpdateEvent?: (id: string, patch: EventPatch) => void
  onDeleteEvent?: (id: string) => void
  onMoveEvent?: (id: string, dir: -1 | 1) => void
  onAddEvent?: (event: { label: string; dateApprox?: string }) => void
  onSortByDate?: () => void
  onUpdateGoal?: (goal: string) => void
}

function midEvents(session: SessionState): TimelineEvent[] {
  return session.events.filter((e) => e.kind === 'event')
}

export function Timeline({
  session,
  activeId,
  banners = [],
  onSelect,
  onUpdateEvent,
  onDeleteEvent,
  onMoveEvent,
  onAddEvent,
  onSortByDate,
  onUpdateGoal,
}: Props) {
  const events = midEvents(session)
  const activeEvent =
    activeId && activeId !== 'start' && activeId !== 'end'
      ? session.events.find((e) => e.id === activeId)
      : undefined
  const editingGoal = activeId === 'end'

  const [draftLabel, setDraftLabel] = useState('')
  const [draftDate, setDraftDate] = useState('')
  const [draftActors, setDraftActors] = useState('')
  const [draftDocs, setDraftDocs] = useState('')
  const [draftGoal, setDraftGoal] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newDate, setNewDate] = useState('')
  const [showMore, setShowMore] = useState(false)

  useEffect(() => {
    if (activeEvent) {
      setDraftLabel(activeEvent.label)
      setDraftDate(activeEvent.dateApprox || '')
      setDraftActors((activeEvent.actors || []).join(', '))
      setDraftDocs((activeEvent.documentLabels || []).join(', '))
      setShowMore(Boolean(activeEvent.actors?.length || activeEvent.documentLabels?.length))
    }
    if (editingGoal) setDraftGoal(session.goal || '')
  }, [activeEvent, editingGoal, session.goal])

  function commitEdit() {
    if (!activeEvent) return
    const label = draftLabel.trim()
    if (!label) return
    const dateApprox = draftDate.trim() || undefined
    onUpdateEvent?.(activeEvent.id, {
      label,
      dateApprox,
      datePrecision: guessDatePrecision(dateApprox),
      actors: parseActorList(draftActors),
      documentLabels: parseActorList(draftDocs),
      clientConfirmed: true,
    })
  }

  function addEvent() {
    const label = newLabel.trim()
    if (!label) return
    onAddEvent?.({ label, dateApprox: newDate.trim() || undefined })
    setNewLabel('')
    setNewDate('')
  }

  const datedCount = events.filter((e) => e.dateApprox?.trim()).length
  const banner = banners[0]

  return (
    <header className="timeline" aria-label="Chronology">
      {banner ? <p className="timeline__banner">{banner}</p> : null}

      <div className="timeline__goal">
        <span className="timeline__goal-label">Outcome</span>
        {editingGoal ? (
          <input
            className="timeline__goal-input"
            value={draftGoal}
            onChange={(e) => setDraftGoal(e.target.value)}
              onBlur={() => {
              onUpdateGoal?.(draftGoal.trim())
              onSelect?.(undefined)
            }}
            placeholder="What do you want?"
            autoFocus
          />
        ) : (
          <button type="button" className="timeline__goal-btn" onClick={() => onSelect?.('end')}>
            {session.goal || 'What do you want?'}
          </button>
        )}
      </div>

      <div className="timeline__list-head">
        <h2 className="timeline__heading">What happened</h2>
        {datedCount >= 2 ? (
          <button type="button" className="timeline__sort" onClick={() => onSortByDate?.()}>
            Sort by date
          </button>
        ) : null}
      </div>

      <ol className="timeline__list">
        {events.length === 0 && (
          <li className="timeline__empty">Add dates and facts. That is what a solicitor reads first.</li>
        )}
        {events.map((node) => {
          const open = activeId === node.id
          return (
            <li key={node.id} className={open ? 'timeline__row timeline__row--open' : 'timeline__row'}>
              <button
                type="button"
                className="timeline__row-main"
                onClick={() => onSelect?.(open ? undefined : node.id)}
              >
                <span className="timeline__when">{node.dateApprox || 'Date?'}</span>
                <span className="timeline__what">{node.label}</span>
              </button>
              {open && (
                <div className="timeline__edit" role="region" aria-label="Edit event">
                  <label className="timeline__field timeline__field--date">
                    <span>Date</span>
                    <input
                      value={draftDate}
                      placeholder="e.g. March 2024"
                      onChange={(e) => setDraftDate(e.target.value)}
                      onBlur={commitEdit}
                    />
                  </label>
                  <label className="timeline__field timeline__field--grow">
                    <span>What happened</span>
                    <input
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      onBlur={commitEdit}
                    />
                  </label>
                  {showMore ? (
                    <>
                      <label className="timeline__field">
                        <span>Who</span>
                        <input
                          value={draftActors}
                          placeholder="Optional"
                          onChange={(e) => setDraftActors(e.target.value)}
                          onBlur={commitEdit}
                        />
                      </label>
                      <label className="timeline__field">
                        <span>Evidence</span>
                        <input
                          value={draftDocs}
                          placeholder="Notice, email, photo…"
                          onChange={(e) => setDraftDocs(e.target.value)}
                          onBlur={commitEdit}
                        />
                      </label>
                    </>
                  ) : (
                    <button type="button" className="timeline__more" onClick={() => setShowMore(true)}>
                      Who / evidence
                    </button>
                  )}
                  <div className="timeline__edit-actions">
                    <button type="button" onClick={() => onMoveEvent?.(node.id, -1)}>
                      Up
                    </button>
                    <button type="button" onClick={() => onMoveEvent?.(node.id, 1)}>
                      Down
                    </button>
                    <button
                      type="button"
                      className="timeline__danger"
                      onClick={() => onDeleteEvent?.(node.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="timeline__add">
        <input
          className="timeline__add-date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          placeholder="Date"
          aria-label="Date"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addEvent()
            }
          }}
        />
        <input
          className="timeline__add-what"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add what happened"
          aria-label="What happened"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addEvent()
            }
          }}
        />
        <button type="button" className="timeline__add-btn" onClick={addEvent} disabled={!newLabel.trim()}>
          Add
        </button>
      </div>
    </header>
  )
}
