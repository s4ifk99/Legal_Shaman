import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionState } from '@/lib/coherence/types'
import {
  reformulateLegalQuery,
  type ReformulationResult,
} from '@/lib/coherence/legalReformulation'
import {
  buildSearchContextProfile,
  contextChips,
  needsEmploymentRoleClarify,
} from '@/lib/coherence/searchContext'
import { glossaryStyleTranslate } from '@/lib/coherence/styleTranslation'
import {
  applyAuthorityInterrogator,
  needsAuthorityInterrogator,
  proposeAuthorityQuestions,
  tryAutoAuthorityResolve,
  type InterrogatorQuestion,
} from '@/lib/coherence/authorityInterrogator'
import './ReformulationGate.css'

export type SearchDestination = 'services' | 'oslaw'
export type EmploymentRoleChoice = 'employee' | 'employer'

interface Props {
  session: SessionState
  destination: SearchDestination
  llmConfigured: boolean
  onConfirm: (query: string) => void
  onUseOriginal: () => void
  onCancel: () => void
  onDownloadNotes: () => void
  /** Persist employment role clarify onto the session */
  onConfirmRole?: (role: EmploymentRoleChoice) => void
  /** Persist T5 authority resolve (local seeds only — no Exa) */
  onAuthorityResolved?: (next: SessionState) => void
}

export function ReformulationGate({
  session,
  destination,
  llmConfigured,
  onConfirm,
  onUseOriginal,
  onCancel,
  onDownloadNotes,
  onConfirmRole,
  onAuthorityResolved,
}: Props) {
  const [busy, setBusy] = useState(true)
  const [result, setResult] = useState<ReformulationResult | null>(null)
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState(false)
  const [ageConfirmedAdult, setAgeConfirmedAdult] = useState(false)
  const [roleOverride, setRoleOverride] = useState<EmploymentRoleChoice | null>(null)
  const [clarifyRole, setClarifyRole] = useState(false)
  const [authorityStep, setAuthorityStep] = useState(false)
  const [authorityQs, setAuthorityQs] = useState<InterrogatorQuestion[]>([])
  const [authorityIndex, setAuthorityIndex] = useState(0)
  const [authorityAnswers, setAuthorityAnswers] = useState<Record<string, string>>({})
  const abortRef = useRef<AbortController | null>(null)

  const effectiveSession = useMemo(
    () =>
      roleOverride ? { ...session, confirmedUserRole: roleOverride } : session,
    [session, roleOverride],
  )

  const profile = useMemo(
    () => buildSearchContextProfile(effectiveSession),
    [effectiveSession],
  )
  const chips = useMemo(() => contextChips(profile), [profile])
  const previewStyle = useMemo(() => {
    const lay =
      draft.trim() ||
      session.rawInputs.find((r) => r.trim().length >= 8)?.trim() ||
      session.whatHappened
    return glossaryStyleTranslate(lay, session.matterType)
  }, [draft, session])

  function runReformulation(
    asAdult: boolean,
    sessionOverride?: SessionState,
  ) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setFailed(false)
    setClarifyRole(false)
    setAuthorityStep(false)

    let s = sessionOverride ?? effectiveSession

    if (needsEmploymentRoleClarify(s)) {
      setClarifyRole(true)
      setBusy(false)
      setResult(null)
      return
    }

    if (needsAuthorityInterrogator(s)) {
      const auto = tryAutoAuthorityResolve(s)
      if (auto) {
        s = auto
        onAuthorityResolved?.(auto)
      } else {
        const qs = proposeAuthorityQuestions(s)
        setAuthorityQs(qs)
        setAuthorityIndex(0)
        setAuthorityAnswers({})
        setAuthorityStep(true)
        setBusy(false)
        setResult(null)
        return
      }
    }

    if (!llmConfigured) {
      setBusy(false)
      setFailed(true)
      return
    }

    void reformulateLegalQuery(s, controller.signal, {
      ageConfirmedAdult: asAdult,
    })
      .then((next) => {
        if (controller.signal.aborted) return
        if (!next) {
          setFailed(true)
          setBusy(false)
          return
        }
        setResult(next)
        setDraft(next.kind === 'reformulation' ? next.text : next.original)
        setBusy(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true)
          setBusy(false)
        }
      })
  }

  useEffect(() => {
    runReformulation(false)
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const label =
    destination === 'oslaw' ? 'OSLAW wiki pathways' : 'matching advisers & guidance'

  if (busy) {
    return (
      <section className="reform-gate" aria-busy="true" aria-live="polite">
        <p className="reform-gate__eyebrow">Before we search</p>
        <h2 className="reform-gate__title">Checking your question…</h2>
        <p className="reform-gate__lead">
          We’re preparing a clearer framing for {label}. You will confirm or edit it before anything
          is retrieved.
        </p>
      </section>
    )
  }

  if (clarifyRole) {
    return (
      <section className="reform-gate reform-gate--clarify" aria-live="polite">
        <p className="reform-gate__eyebrow">Quick check</p>
        <h2 className="reform-gate__title">Are you the worker or the employer?</h2>
        <p className="reform-gate__lead">
          This looks like a work issue, but we need one detail so we search the right pathways.
        </p>
        <div className="reform-gate__actions">
          <button
            type="button"
            className="reform-gate__primary"
            onClick={() => {
              setRoleOverride('employee')
              onConfirmRole?.('employee')
              runReformulation(ageConfirmedAdult, {
                ...session,
                confirmedUserRole: 'employee',
              })
            }}
          >
            I’m the employee / worker
          </button>
          <button
            type="button"
            className="reform-gate__secondary"
            onClick={() => {
              setRoleOverride('employer')
              onConfirmRole?.('employer')
              runReformulation(ageConfirmedAdult, {
                ...session,
                confirmedUserRole: 'employer',
              })
            }}
          >
            I’m the employer
          </button>
          <button type="button" className="reform-gate__ghost" onClick={onCancel}>
            Back
          </button>
        </div>
      </section>
    )
  }

  if (authorityStep && authorityQs.length > 0) {
    const q = authorityQs[authorityIndex] || authorityQs[0]
    return (
      <section className="reform-gate reform-gate--clarify" aria-live="polite">
        <p className="reform-gate__eyebrow">
          Narrowing trusted guidance ({authorityIndex + 1}/{authorityQs.length})
        </p>
        <h2 className="reform-gate__title">{q.text}</h2>
        <p className="reform-gate__lead">
          We match only curated UK authority pages (GOV.UK, Citizens Advice, ACAS, etc.) — no open
          web crawl.
        </p>
        <div className="reform-gate__actions">
          {q.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="reform-gate__secondary"
              onClick={() => {
                const nextAnswers = { ...authorityAnswers, [q.id]: opt.value }
                setAuthorityAnswers(nextAnswers)
                if (authorityIndex + 1 < authorityQs.length) {
                  setAuthorityIndex(authorityIndex + 1)
                  return
                }
                const resolved = applyAuthorityInterrogator(effectiveSession, nextAnswers)
                onAuthorityResolved?.(resolved)
                runReformulation(ageConfirmedAdult, resolved)
              }}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            className="reform-gate__ghost"
            onClick={() => {
              // Skip remaining: mark gate answered so we don't loop; continue without hits
              const skipped: SessionState = {
                ...effectiveSession,
                answeredPromptIds: Array.from(
                  new Set([...effectiveSession.answeredPromptIds, 'authority_gate']),
                ),
              }
              onAuthorityResolved?.(skipped)
              runReformulation(ageConfirmedAdult, skipped)
            }}
          >
            Skip — continue with my words
          </button>
          <button type="button" className="reform-gate__ghost" onClick={onCancel}>
            Back
          </button>
        </div>
      </section>
    )
  }

  if (result?.kind === 'clarify_age') {
    return (
      <section className="reform-gate reform-gate--clarify" aria-live="polite">
        <p className="reform-gate__eyebrow">Quick check</p>
        <h2 className="reform-gate__title">Are you under 18?</h2>
        <p className="reform-gate__lead">
          {result.clarifyPrompt ||
            'Before we search: are you under 18, or is this about someone under 18 while you are an adult?'}
        </p>
        <div className="reform-gate__actions">
          <button
            type="button"
            className="reform-gate__primary"
            onClick={() => {
              setResult({
                kind: 'refuse',
                text: '',
                original: result.original,
                gateOutcome: 'refuse_escalate',
                refuseReason:
                  'Because you are under 18, we should not run automatic legal search. A human path is safer.',
                escalateHint:
                  'Speak to a trusted adult, Childline (0800 1111), or a regulated adviser who works with young people. If you are in immediate danger, call 999.',
              })
            }}
          >
            Yes — I am under 18
          </button>
          <button
            type="button"
            className="reform-gate__secondary"
            onClick={() => {
              setAgeConfirmedAdult(true)
              runReformulation(true)
            }}
          >
            No — I am 18 or over
          </button>
          <button type="button" className="reform-gate__ghost" onClick={onCancel}>
            Back
          </button>
        </div>
      </section>
    )
  }

  if (result?.kind === 'refuse') {
    const hardGate = result.gateOutcome === 'refuse_escalate'
    return (
      <section className="reform-gate reform-gate--refuse" aria-live="polite">
        <p className="reform-gate__eyebrow">We should pause automatic search</p>
        <h2 className="reform-gate__title">This needs a human path first</h2>
        <p className="reform-gate__lead">{result.refuseReason}</p>
        {result.escalateHint ? (
          <p className="reform-gate__escalate">
            <strong>Next:</strong> {result.escalateHint}
          </p>
        ) : null}
        <div className="reform-gate__actions">
          <button type="button" className="reform-gate__primary" onClick={onDownloadNotes}>
            Download notes for a solicitor
          </button>
          {hardGate ? (
            <button
              type="button"
              className="reform-gate__secondary"
              onClick={() => {
                setAgeConfirmedAdult(true)
                runReformulation(true)
              }}
            >
              I confirm I am 18 or over — continue
            </button>
          ) : (
            <button type="button" className="reform-gate__secondary" onClick={onUseOriginal}>
              Search with my original words anyway
            </button>
          )}
          <button type="button" className="reform-gate__ghost" onClick={onCancel}>
            Back
          </button>
        </div>
      </section>
    )
  }

  if (failed || !result) {
    return (
      <section className="reform-gate" aria-live="polite">
        <p className="reform-gate__eyebrow">Before we search</p>
        <h2 className="reform-gate__title">Continue with your own words?</h2>
        <p className="reform-gate__lead">
          We couldn’t propose a reformulation right now. You can still search using what you already
          told us.
        </p>
        {chips.length > 0 && (
          <ul className="reform-gate__chips" aria-label="Search context">
            {chips.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        <div className="reform-gate__actions">
          <button type="button" className="reform-gate__primary" onClick={onUseOriginal}>
            Search with my words
          </button>
          <button type="button" className="reform-gate__ghost" onClick={onCancel}>
            Back
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="reform-gate" aria-live="polite">
      <p className="reform-gate__eyebrow">Confirm before search</p>
      <h2 className="reform-gate__title">Does this capture what you need?</h2>
      <p className="reform-gate__lead">
        Edit freely. Nothing is retrieved until you confirm. This is framing for search — not legal
        advice.
        {ageConfirmedAdult ? ' (Age confirmed as adult.)' : ''}
      </p>

      {chips.length > 0 && (
        <ul className="reform-gate__chips" aria-label="Search context">
          {chips.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}

      {session.authorityHits?.length ? (
        <ul className="reform-gate__chips" aria-label="Trusted guidance matched">
          {session.authorityHits.slice(0, 3).map((h) => (
            <li key={h.id}>{h.title}</li>
          ))}
        </ul>
      ) : null}

      <label className="reform-gate__label" htmlFor="reform-original">
        What you said
      </label>
      <p id="reform-original" className="reform-gate__original">
        {result.original}
      </p>

      <label className="reform-gate__label" htmlFor="reform-draft">
        Proposed search question
      </label>
      <textarea
        id="reform-draft"
        className="reform-gate__draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
      />

      {previewStyle && previewStyle !== draft.trim() ? (
        <>
          <p className="reform-gate__label">Also retrieving with formal phrasing</p>
          <p className="reform-gate__style-preview">{previewStyle}</p>
          <p className="reform-gate__metric">
            AB metric for this intent: <code>{profile.abPrimaryMetric}</code>
          </p>
        </>
      ) : null}

      <div className="reform-gate__actions">
        <button
          type="button"
          className="reform-gate__primary"
          disabled={draft.trim().length < 8}
          onClick={() => onConfirm(draft.trim())}
        >
          Confirm &amp; search {destination === 'oslaw' ? 'OSLAW' : 'help'}
        </button>
        <button type="button" className="reform-gate__secondary" onClick={onUseOriginal}>
          Use my original words
        </button>
        <button type="button" className="reform-gate__ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    </section>
  )
}
