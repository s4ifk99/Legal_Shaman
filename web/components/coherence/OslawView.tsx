'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionState } from '@/lib/coherence/types'
import type { LegalFrame } from '@/lib/coherence/frames'
import {
  buildAnswerPackage,
  type AnswerPackage,
} from '@/lib/coherence/answerPackage'
import { matchOslawCourse } from '@/lib/coherence/wiki'
import {
  runOslawPreflight,
  type PreflightIssue,
} from '@/lib/coherence/oslawPreflight'
import {
  fetchRetrieveAnswer,
  isFinalOverviewPackage,
} from '@/lib/coherence/retrieveAnswer'
import { logSearchEvent } from '@/lib/coherence/searchAnalytics'
import { SynthesisHourglass } from './SynthesisHourglass'
import './OslawView.css'

interface Props {
  session: SessionState
  frames?: LegalFrame[]
  masterAnswerPackage?: AnswerPackage | null
  /** Master pipeline still running final synthesis — keep loading, do not show interim packs. */
  overviewLoading?: boolean
  onBack: () => void
  onFindHelp: () => void
}

function Recommendation({
  pack,
  preflightNote,
  authorityHits,
}: {
  pack: AnswerPackage
  preflightNote?: string | null
  authorityHits?: SessionState['authorityHits']
}) {
  const takeaways = pack.bullets.filter((b) => b.text.trim().length >= 12).slice(0, 5)
  const pages = pack.wikiPages.slice(0, 6)
  const sources = pack.sources.slice(0, 6)
  const firms = pack.recommendedFirms.slice(0, 3)

  return (
    <article className="oslaw__rec" aria-label="Recommendation">
      <header className="oslaw__rec-head">
        <h2 className="oslaw__rec-title">Recommendation</h2>
        <p className="oslaw__rec-origin">Legal Shaman wiki · signposting only</p>
      </header>

      <div className="oslaw__rec-body">{pack.answerOverview}</div>

      {preflightNote ? (
        <p className="oslaw__rec-note" role="status">
          {preflightNote}
        </p>
      ) : null}

      {authorityHits && authorityHits.length > 0 ? (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">Authority pages</h3>
          <ul className="oslaw__rec-list oslaw__rec-list--links">
            {authorityHits.slice(0, 6).map((h) => (
              <li key={h.id}>
                <a href={h.url} target="_blank" rel="noreferrer">
                  {h.title}
                </a>
                <span>
                  {' '}
                  —{' '}
                  {h.kind === 'law_firm' || h.tier === 'firm'
                    ? `firm · ${h.firm || 'commentary'}`
                    : h.tier}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {takeaways.length > 0 && (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">Key takeaways</h3>
          <ul className="oslaw__rec-list">
            {takeaways.map((b, i) => (
              <li key={`${i}-${b.text.slice(0, 24)}`}>
                {b.text}
                {b.sourceUrl ? (
                  <>
                    {' '}
                    <a href={b.sourceUrl} target="_blank" rel="noreferrer">
                      {b.sourceTitle || 'source'} →
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pages.length > 0 && (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">Relevant wiki pages</h3>
          <ul className="oslaw__rec-pages">
            {pages.map((w) => (
              <li key={w.path + w.title}>{w.title}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="oslaw__rec-section">
        <h3 className="oslaw__rec-h">Free help first</h3>
        <ul className="oslaw__rec-list oslaw__rec-list--links">
          {(pack.freeHelp.length
            ? pack.freeHelp
            : [
                {
                  title: 'Citizens Advice',
                  url: 'https://www.citizensadvice.org.uk/get-advice/',
                  blurb: 'Free guidance.',
                },
              ]
          ).map((h) => (
            <li key={h.url}>
              <a href={h.url} target="_blank" rel="noreferrer">
                {h.title}
              </a>
              {h.blurb ? <span> — {h.blurb}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      {firms.length > 0 && (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">Firms with indexed commentary</h3>
          <p className="oslaw__rec-note">Optional signposting — not endorsements.</p>
          <ul className="oslaw__rec-list oslaw__rec-list--links">
            {firms.map((f) => (
              <li key={f.directoryUrl}>
                <a href={f.directoryUrl} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
                {f.note ? <span> — {f.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sources.length > 0 && (
        <details className="oslaw__rec-sources">
          <summary>Sources ({sources.length})</summary>
          <ul>
            {sources.map((s) => (
              <li key={s.title}>{s.title}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="oslaw__rec-disclaimer">{pack.policyNote}</p>
    </article>
  )
}

function pickBestPack(
  local: AnswerPackage,
  master: AnswerPackage | null,
  retrieved: AnswerPackage | null,
): AnswerPackage {
  // Deterministic R&D topic packs win when they matched (parking, CRA, etc.).
  if (local.matchedTopicId && local.bullets.length > 0) return local
  if (master && isFinalOverviewPackage(master)) return master
  if (retrieved && isFinalOverviewPackage(retrieved)) return retrieved
  return local
}

export function OslawView({
  session,
  frames = [],
  masterAnswerPackage = null,
  overviewLoading = false,
  onBack,
  onFindHelp,
}: Props) {
  const basePack = useMemo(() => buildAnswerPackage(session, frames), [session, frames])
  const [pack, setPack] = useState<AnswerPackage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([])
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    let cancelled = false
    const abort = new AbortController()
    mountedAt.current = Date.now()

    if (overviewLoading) {
      setPack(null)
      setLoading(true)
      setError(null)
      setPreflightIssues([])
      return () => {
        cancelled = true
        abort.abort()
      }
    }

    setLoading(true)
    setError(null)
    setPreflightIssues([])

    void (async () => {
      const course = await matchOslawCourse(session, frames)
      if (cancelled) return

      let retrieved: AnswerPackage | null = null
      if (!basePack.matchedTopicId) {
        const res = await fetchRetrieveAnswer(session, frames)
        if (cancelled) return
        retrieved = res?.answerPackage ?? null
      }

      const candidate = pickBestPack(
        basePack,
        isFinalOverviewPackage(masterAnswerPackage) ? masterAnswerPackage : null,
        retrieved,
      )

      const preflight = await runOslawPreflight(
        session,
        frames,
        candidate,
        course,
        abort.signal,
      )
      if (cancelled) return

      setDisplayFromPreflight(preflight.pack, preflight.issues)
      setLoading(false)

      logSearchEvent(session, {
        view: 'oslaw',
        type: 'impression',
        resultIds: [
          ...(preflight.course ? [preflight.course.pathwayId] : []),
          ...preflight.pack.wikiPages.map((w) => w.path),
          ...preflight.pack.freeHelp.map((h) => h.url),
        ],
        meta: {
          primaryMetric: session.abPrimaryMetric,
          pathway: preflight.course?.title || '',
          preflightOk: preflight.ok,
          preflightCodes: preflight.issues.map((i) => i.code).join(','),
          matchedTopicId: preflight.pack.matchedTopicId || '',
        },
      })
    })()

    return () => {
      cancelled = true
      abort.abort()
      const dwellMs = Date.now() - mountedAt.current
      if (dwellMs >= 800) {
        logSearchEvent(session, {
          view: 'oslaw',
          type: 'dwell',
          dwellMs,
        })
      }
    }

    function setDisplayFromPreflight(next: AnswerPackage, issues: PreflightIssue[]) {
      setPack(next)
      setPreflightIssues(issues)
      if (!next.answerOverview?.trim() && next.bullets.length === 0) {
        setError('Could not build a wiki-grounded recommendation for this story yet.')
      } else {
        setError(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, frames, masterAnswerPackage, overviewLoading, basePack])

  const blockedPathway = preflightIssues.some((i) => i.severity === 'block-pathway')
  const preflightNote = blockedPathway
    ? 'Some wiki pathways were withheld after a pre-display check (topic mismatch).'
    : preflightIssues.some((i) => i.severity === 'drop-url')
      ? 'Some links were removed after a liveness check.'
      : null

  const ready = Boolean(pack && (pack.answerOverview.trim() || pack.bullets.length > 0))

  return (
    <div className="oslaw">
      <header className="oslaw__header">
        <button type="button" className="oslaw__back" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1 className="oslaw__title">Overview</h1>
          <p className="oslaw__lead">
            Practical signposting from curated authority + Legal Shaman wiki — not legal advice.
          </p>
        </div>
      </header>

      {loading && (
        <div className="oslaw__status oslaw__status--busy">
          <SynthesisHourglass
            label={
              overviewLoading
                ? 'Synthesising your recommendation from wiki sources…'
                : 'Building recommendation (authority + wiki preflight)…'
            }
          />
        </div>
      )}

      {!loading && ready && pack && (
        <div className="oslaw__body">
          <Recommendation
            pack={pack}
            preflightNote={preflightNote}
            authorityHits={session.authorityHits}
          />
          <div className="oslaw__actions">
            <button type="button" className="oslaw__btn oslaw__btn--primary" onClick={onFindHelp}>
              Find people to help
            </button>
            <button type="button" className="oslaw__btn" onClick={onBack}>
              Add more to your story
            </button>
          </div>
        </div>
      )}

      {!loading && !ready && (
        <div className="oslaw__body">
          <p className="oslaw__status">{error || 'No recommendation yet.'}</p>
          <div className="oslaw__actions">
            <button type="button" className="oslaw__btn oslaw__btn--primary" onClick={onFindHelp}>
              Find people to help
            </button>
            <button type="button" className="oslaw__btn" onClick={onBack}>
              Add more to your story
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
