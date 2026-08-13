import { useMemo, useRef, useState } from 'react'
import type { SessionState } from '@/lib/coherence/types'
import { buildSolicitorBrief, type SolicitorBriefV0 } from '@/lib/coherence/brief'
import type { LegalFrame } from '@/lib/coherence/frames'
import type { LawyerSession } from '@/lib/coherence/lawyerAuth'
import { signOutLawyer } from '@/lib/coherence/lawyerAuth'
import {
  loadInbox,
  parseBriefJson,
  queueHandoff,
  removeHandoff,
  type HandoffInboxItem,
} from '@/lib/coherence/lawyerInbox'
import { LawyerNotes } from './LawyerNotes'
import './LawyerPortal.css'

interface Props {
  lawyer: LawyerSession
  /** Live client intake on this browser (demo handoff). */
  liveSession?: SessionState | null
  liveProgress?: number
  liveFrames?: LegalFrame[]
  onSignedOut: () => void
  onBackToClient: () => void
}

export function LawyerPortal({
  lawyer,
  liveSession = null,
  liveProgress = 0,
  liveFrames = [],
  onSignedOut,
  onBackToClient,
}: Props) {
  const [inbox, setInbox] = useState(() => loadInbox())
  const [active, setActive] = useState<HandoffInboxItem | null>(null)
  const [liveOpen, setLiveOpen] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const liveBrief = useMemo(() => {
    if (!liveSession || liveSession.rawInputs.length === 0) return null
    return buildSolicitorBrief(liveSession, liveProgress, liveFrames, {
      corpusVersion: 'immigrationWiki.json',
    })
  }, [liveSession, liveProgress, liveFrames])

  function refreshInbox() {
    setInbox(loadInbox())
  }

  function queueLive() {
    if (!liveBrief) return
    setInbox(queueHandoff(liveBrief, 'live_session', 'Live intake on this device'))
  }

  function onImportFile(file: File) {
    setImportError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const brief = parseBriefJson(String(reader.result || ''))
      if (!brief) {
        setImportError('Could not read a c1.brief.v0 JSON handoff.')
        return
      }
      setInbox(queueHandoff(brief, 'import', file.name))
    }
    reader.onerror = () => setImportError('Failed to read file.')
    reader.readAsText(file)
  }

  function openItem(item: HandoffInboxItem) {
    setLiveOpen(false)
    setActive(item)
  }

  function openLive() {
    if (!liveSession) return
    setActive(null)
    setLiveOpen(true)
  }

  function signOut() {
    signOutLawyer()
    onSignedOut()
  }

  if (liveOpen && liveSession) {
    return (
      <LawyerNotes
        session={liveSession}
        progress={liveProgress}
        frames={liveFrames}
        audience="lawyer"
        lawyerName={lawyer.displayName}
        onBack={() => setLiveOpen(false)}
      />
    )
  }

  if (active) {
    return (
      <ImportedBriefReview
        brief={active.brief}
        lawyerName={lawyer.displayName}
        onBack={() => {
          setActive(null)
          refreshInbox()
        }}
        onRemove={() => {
          setInbox(removeHandoff(active.id))
          setActive(null)
        }}
      />
    )
  }

  return (
    <div className="lawyer-portal">
      <header className="lawyer-portal__chrome">
        <div>
          <p className="lawyer-portal__brand">Legal Shaman · Solicitor</p>
          <h1 className="lawyer-portal__title">Handoff inbox</h1>
          <p className="lawyer-portal__who">
            Signed in as {lawyer.displayName} ({lawyer.email})
          </p>
        </div>
        <div className="lawyer-portal__actions">
          <button type="button" className="lawyer-portal__btn" onClick={onBackToClient}>
            Client site
          </button>
          <button type="button" className="lawyer-portal__btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <p className="lawyer-portal__lead">
        Accept, edit, or reject classifications here. This review surface is never shown to lay
        clients.
      </p>

      <section className="lawyer-portal__section">
        <h2>Add a handoff</h2>
        <div className="lawyer-portal__row">
          <button
            type="button"
            className="lawyer-portal__btn lawyer-portal__btn--solid"
            disabled={!liveBrief}
            onClick={queueLive}
          >
            Queue live intake
          </button>
          <button
            type="button"
            className="lawyer-portal__btn"
            disabled={!liveSession || liveSession.rawInputs.length === 0}
            onClick={openLive}
          >
            Review live intake
          </button>
          <button type="button" className="lawyer-portal__btn" onClick={() => fileRef.current?.click()}>
            Import brief JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="lawyer-portal__file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportFile(f)
              e.target.value = ''
            }}
          />
        </div>
        {importError && (
          <p className="lawyer-portal__error" role="alert">
            {importError}
          </p>
        )}
        {!liveBrief && (
          <p className="lawyer-portal__hint">
            No live client intake on this device yet — import a downloaded brief JSON, or complete an
            intake on the client site first.
          </p>
        )}
      </section>

      <section className="lawyer-portal__section">
        <h2>Queued briefs ({inbox.items.length})</h2>
        {inbox.items.length === 0 ? (
          <p className="lawyer-portal__hint">Inbox empty.</p>
        ) : (
          <ul className="lawyer-portal__list">
            {inbox.items.map((item) => (
              <li key={item.id}>
                <button type="button" className="lawyer-portal__item" onClick={() => openItem(item)}>
                  <span className="lawyer-portal__item-label">{item.label}</span>
                  <span className="lawyer-portal__item-meta">
                    {item.source.replace('_', ' ')} · {new Date(item.queued_at).toLocaleString('en-GB')} ·{' '}
                    {item.brief.matter_type}
                  </span>
                </button>
                <button
                  type="button"
                  className="lawyer-portal__remove"
                  onClick={() => setInbox(removeHandoff(item.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Lightweight shell: rebuild a minimal SessionState from an imported Phase 0 brief for LawyerNotes. */
function ImportedBriefReview({
  brief,
  lawyerName,
  onBack,
  onRemove,
}: {
  brief: SolicitorBriefV0
  lawyerName: string
  onBack: () => void
  onRemove: () => void
}) {
  const session = useMemo(() => briefToSession(brief), [brief])
  const frames = useMemo(
    () =>
      brief.issues.map((i, idx) => ({
        id: i.id,
        label: i.plain_label,
        why: i.why_this_frame.join('; '),
        score: 100 - idx,
        unmetConstraints: i.unmet_constraints,
      })),
    [brief],
  )

  return (
    <div>
      <div className="lawyer-portal__import-bar no-print">
        <button type="button" className="lawyer-portal__btn" onClick={onBack}>
          ← Inbox
        </button>
        <button type="button" className="lawyer-portal__btn" onClick={onRemove}>
          Remove from inbox
        </button>
      </div>
      <LawyerNotes
        session={session}
        progress={90}
        frames={frames}
        audience="lawyer"
        lawyerName={lawyerName}
        importedBrief={brief}
        onBack={onBack}
      />
    </div>
  )
}

function briefToSession(brief: SolicitorBriefV0): SessionState {
  return {
    rawInputs: [brief.matter_summary_plain || brief.client_goal.stated],
    events: brief.timeline.map((t, i) => ({
      id: `t-${i}`,
      label: t.event,
      dateApprox: t.date_approx,
      kind: 'event' as const,
    })),
    whatHappened: brief.matter_summary_plain,
    howCaused: '',
    goal: brief.client_goal.stated,
    parties: brief.parties.map((p) => ({ label: p.name_or_label, role: p.role })),
    documents: brief.documents_mentioned.map((d) => d.label),
    matterType: brief.matter_type,
    jurisdiction: brief.jurisdiction,
    locationHint: '',
    mode: 'dispute',
    softFlags: brief.client.vulnerability_flags || [],
    safetyRisk: brief.risk_and_safety.immediate_danger,
    answeredPromptIds: ['complete'],
  }
}
