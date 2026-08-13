import { useEffect, useState } from 'react'
import type { SessionState, TimelineEvent } from '@/lib/coherence/types'
import './Timeline.css'

interface Props {
  session: SessionState
  activeId?: string
  onSelect?: (id: string) => void
  onUpdateEvent?: (id: string, patch: Partial<Pick<TimelineEvent, 'label' | 'dateApprox'>>) => void
  onDeleteEvent?: (id: string) => void
  onMoveEvent?: (id: string, dir: -1 | 1) => void
  onUpdateGoal?: (goal: string) => void
}

function nodesFor(session: SessionState): TimelineEvent[] {
  const start: TimelineEvent = {
    id: 'start',
    label: 'Start',
    kind: 'start',
    dateApprox: session.events[0]?.dateApprox,
  }
  const mid = session.events.filter((e) => e.kind === 'event')
  const end: TimelineEvent = {
    id: 'end',
    label: session.goal ? session.goal : 'Goal',
    kind: 'goal',
  }
  return [start, ...mid, end]
}

/** Compact label for the track — full text stays on title + edit panel. */
function displayLabel(label: string, max = 54): string {
  const cleaned = label.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  const cut = cleaned.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > 24 ? cut.slice(0, at) : cut).trimEnd()}…`
}

export function Timeline({
  session,
  activeId,
  onSelect,
  onUpdateEvent,
  onDeleteEvent,
  onMoveEvent,
  onUpdateGoal,
}: Props) {
  const nodes = nodesFor(session)
  const activeEvent =
    activeId && activeId !== 'start' && activeId !== 'end'
      ? session.events.find((e) => e.id === activeId)
      : undefined
  const editingGoal = activeId === 'end'
  const canEdit = Boolean(activeEvent || editingGoal)

  const [draftLabel, setDraftLabel] = useState('')
  const [draftDate, setDraftDate] = useState('')
  const [draftGoal, setDraftGoal] = useState('')

  useEffect(() => {
    if (activeEvent) {
      setDraftLabel(activeEvent.label)
      setDraftDate(activeEvent.dateApprox || '')
    }
    if (editingGoal) setDraftGoal(session.goal || '')
  }, [activeEvent, editingGoal, session.goal])

  return (
    <header className="timeline" aria-label="Issue timeline">
      <div className="timeline__track">
        {nodes.map((node, i) => (
          <div key={node.id} className="timeline__item">
            {i > 0 && <div className="timeline__segment" aria-hidden />}
            <button
              type="button"
              className={[
                'timeline__node',
                node.kind === 'start' || node.kind === 'goal' ? 'timeline__node--anchor' : '',
                activeId === node.id ? 'timeline__node--active' : '',
                node.kind === 'goal' && session.goal ? 'timeline__node--filled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect?.(node.id)}
              title={node.dateApprox ? `${node.label} · ${node.dateApprox}` : node.label}
            >
              <span className="timeline__dot" />
              <span className="timeline__label">
                {node.dateApprox ? <span className="timeline__date">{node.dateApprox}</span> : null}
                {displayLabel(node.label, node.kind === 'goal' ? 48 : 54)}
              </span>
            </button>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="timeline__edit" role="region" aria-label="Edit timeline item">
          {activeEvent && (
            <>
              <label className="timeline__field">
                <span>Event</span>
                <input
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  onBlur={() => {
                    if (draftLabel.trim() && draftLabel !== activeEvent.label) {
                      onUpdateEvent?.(activeEvent.id, { label: draftLabel.trim() })
                    }
                  }}
                />
                {activeEvent.rawSpan && activeEvent.rawSpan !== activeEvent.label && (
                  <p className="timeline__detail" title={activeEvent.rawSpan}>
                    {activeEvent.rawSpan}
                  </p>
                )}
              </label>
              <label className="timeline__field timeline__field--narrow">
                <span>When</span>
                <input
                  value={draftDate}
                  placeholder="e.g. 2024"
                  onChange={(e) => setDraftDate(e.target.value)}
                  onBlur={() => onUpdateEvent?.(activeEvent.id, { dateApprox: draftDate.trim() })}
                />
              </label>
              <div className="timeline__edit-actions">
                <button type="button" onClick={() => onMoveEvent?.(activeEvent.id, -1)}>
                  ←
                </button>
                <button type="button" onClick={() => onMoveEvent?.(activeEvent.id, 1)}>
                  →
                </button>
                <button
                  type="button"
                  className="timeline__danger"
                  onClick={() => onDeleteEvent?.(activeEvent.id)}
                >
                  Remove
                </button>
              </div>
            </>
          )}
          {editingGoal && (
            <label className="timeline__field timeline__field--grow">
              <span>Desired goal</span>
              <input
                value={draftGoal}
                onChange={(e) => setDraftGoal(e.target.value)}
                onBlur={() => onUpdateGoal?.(draftGoal.trim())}
                placeholder="What do you want to achieve?"
              />
            </label>
          )}
        </div>
      )}
    </header>
  )
}
