'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { SearchMode, SessionState } from '@/lib/coherence/types'
import type { LegalFrame } from '@/lib/coherence/frames'
import {
  buildAnswerPackage,
  type AnswerFollowUp,
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
import { PageNavigation, type PageNavigationProps } from './PageNavigation'
import './OslawView.css'

/** Wiki `path` is a page id (sometimes still ends in `.md` from spines). */
function wikiArticleHref(path: string): string {
  const id = path.replace(/\.md$/i, '').replace(/^\/+/, '')
  return `/ask-the-shaman/wiki/${encodeURIComponent(id)}`
}

interface Props {
  session: SessionState
  frames?: LegalFrame[]
  masterAnswerPackage?: AnswerPackage | null
  /** Master pipeline still running final synthesis — keep loading, do not show interim packs. */
  overviewLoading?: boolean
  onBack: () => void
  onFindHelp: () => void
  onFollowUp: (followUp: AnswerFollowUp) => void
  searchMode: SearchMode
  onStartPenumbraResearch: (message?: string) => void
  onUsePenumbraResearch: () => void
  pageNavigation?: PageNavigationProps
}

function Recommendation({
  pack,
  preflightNote,
  authorityHits,
  onFollowUp,
}: {
  pack: AnswerPackage
  preflightNote?: string | null
  authorityHits?: SessionState['authorityHits']
  onFollowUp: (followUp: AnswerFollowUp) => void
}) {
  const takeaways = pack.bullets.filter((b) => b.text.trim().length >= 12).slice(0, 5)
  const pages = pack.wikiPages.slice(0, 6)
  const sources = pack.sources.slice(0, 6)
  const firms = pack.recommendedFirms.slice(0, 3)

  return (
    <article className="oslaw__rec" aria-label="Recommendation">
      <header className="oslaw__rec-head">
        <h2 className="oslaw__rec-title">Recommendation</h2>
        <p className="oslaw__rec-origin">
          {pack.researchBundle
            ? 'Legal Shaman wiki + Third Eye research · signposting only'
            : 'Legal Shaman wiki · signposting only'}
        </p>
      </header>

      <section className="oslaw__rec-section">
        <h3 className="oslaw__rec-h">What the sources say</h3>
        <div className="oslaw__rec-body">{pack.answerOverview}</div>
      </section>

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

      {pack.recommendations.length > 0 && (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">Recommended next steps</h3>
          <ul className="oslaw__rec-list">
            {pack.recommendations.map((recommendation) => (
              <li key={recommendation}>{recommendation}</li>
            ))}
          </ul>
        </section>
      )}

      {pack.options.length > 0 && (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">Your options</h3>
          <div className="oslaw__options">
            {pack.options.map((option) => (
              <div className="oslaw__option" key={option.title}>
                <h4>{option.title}</h4>
                {option.description ? <p>{option.description}</p> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {pack.missingFacts.length > 0 && (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">What could change the guidance</h3>
          <ul className="oslaw__rec-list">
            {pack.missingFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </section>
      )}

      {pack.followUps.length > 0 && (
        <section className="oslaw__rec-section oslaw__follow-up" aria-label="Improve this result">
          <h3 className="oslaw__rec-h">Ask/refine this result</h3>
          <p className="oslaw__rec-note">
            Add context or tell us what you want to focus on. We’ll use it to refine the guidance.
          </p>
          <div className="oslaw__follow-up-actions">
            {pack.followUps.map((followUp) => (
              <button
                type="button"
                className="oslaw__btn"
                key={followUp.id}
                onClick={() => onFollowUp(followUp)}
              >
                {followUp.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {pages.length > 0 && (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">Relevant wiki pages</h3>
          <ul className="oslaw__rec-pages oslaw__rec-list--links">
            {pages.map((w) => (
              <li key={w.path + w.title}>
                {w.path ? (
                  <Link href={wikiArticleHref(w.path)}>{w.title}</Link>
                ) : (
                  w.title
                )}
              </li>
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
          <ul className="oslaw__rec-list--links">
            {sources.map((s) => (
              <li key={s.title + (s.url || '')}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {pack.researchBundle ? (
        <details className="oslaw__rec-sources oslaw__research-bundle">
          <summary>
            Third Eye research ({pack.researchBundle.sources.length} labelled sources)
          </summary>
          <p className="oslaw__rec-note">
            Supplemental exploration only. Legal Shaman checks the final answer against its own grounded sources.
          </p>
          <ul className="oslaw__rec-list--links">
            {pack.researchBundle.sources.map((source) => (
              <li key={source.id}>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                ) : (
                  source.title
                )}{' '}
                <span>
                  ({source.origin === 'external' ? 'external · unverified' : 'curated'} · {source.tier})
                </span>
              </li>
            ))}
          </ul>
          {pack.researchBundle.claims.length ? (
            <>
              <p className="oslaw__rec-note">Source-linked claims and confidence</p>
              <ul className="oslaw__rec-list">
                {pack.researchBundle.claims.map((claim) => (
                  <li key={claim.claim}>
                    {claim.claim} <span>({claim.confidence}; {claim.sourceIds.join(', ')})</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {pack.researchBundle.conflicts.length ? (
            <p className="oslaw__rec-note">
              Conflicts to check: {pack.researchBundle.conflicts.join(' · ')}
            </p>
          ) : null}
        </details>
      ) : null}

      <p className="oslaw__rec-disclaimer">{pack.policyNote}</p>
    </article>
  )
}

function pickBestPack(
  local: AnswerPackage,
  master: AnswerPackage | null,
  retrieved: AnswerPackage | null,
  mode: SearchMode,
  preferRetrieved = false,
): AnswerPackage {
  if (mode === 'penumbra' || preferRetrieved) {
    if (local.matchedTopicId === 'research-led' && local.bullets.length > 0) return local
    if (master && isFinalOverviewPackage(master)) return master
    if (retrieved && isFinalOverviewPackage(retrieved)) return retrieved
  }
  // Deterministic R&D topic packs win when they matched (parking, CRA, etc.).
  if (local.matchedTopicId && local.matchedTopicId !== 'matter-housing' && local.bullets.length > 0) {
    if (local.matchedTopicId.startsWith('matter-') && retrieved && isFinalOverviewPackage(retrieved)) {
      return retrieved
    }
    if (!local.matchedTopicId.startsWith('matter-')) return local
  }
  if (master && isFinalOverviewPackage(master)) return master
  if (retrieved && isFinalOverviewPackage(retrieved)) return retrieved
  return local
}

function PenumbraResearchPanel({
  session,
  onStart,
  onUseFindings,
}: {
  session: SessionState
  onStart: (message?: string) => void
  onUseFindings: () => void
}) {
  const research = session.penumbraResearch
  const [reply, setReply] = useState('')
  if (session.searchMode !== 'penumbra') return null

  const busy = research?.status === 'starting'
  const hasFindings = Boolean(research?.bundle)
  const researchError =
    research?.error === 'concurrent'
      ? 'A previous research request is still finishing. Please try again shortly.'
      : research?.error
  return (
    <section className="oslaw__research-panel" aria-labelledby="penumbra-research-title">
      <div className="oslaw__research-head">
        <div>
          <h2 id="penumbra-research-title" className="oslaw__rec-h">
            Third Eye exploratory research
          </h2>
          <p className="oslaw__rec-note">
            The Shaman first reviews curated Legal Shaman sources, then researches wider public sources for gaps. It supplies labelled leads only; Legal Shaman remains responsible for the answer.
          </p>
        </div>
        <span className="oslaw__research-status">{research?.status || 'not started'}</span>
      </div>

      {researchError ? <p className="oslaw__research-error">{researchError}</p> : null}
      {research?.fallback ? (
        <p className="oslaw__rec-note" role="status">
          The Shaman could not complete the open-web phase. These are curated Legal Shaman sources only; no external research was added.
        </p>
      ) : null}
      {!research || research.status === 'idle' || research.status === 'error' ? (
        <button type="button" className="oslaw__btn" onClick={() => onStart()} disabled={busy}>
          Run exploratory research
        </button>
      ) : null}
      {busy ? (
        <p className="oslaw__rec-note" role="status">
          The Shaman is collating scoped sources. This does not change the Legal Shaman answer.
        </p>
      ) : null}

      {research?.questions.length ? (
        <div className="oslaw__research-questions">
          <h3 className="oslaw__rec-h">The Shaman needs more research detail</h3>
          <ul className="oslaw__rec-list">
            {research.questions.map((question) => <li key={question}>{question}</li>)}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const value = reply.trim()
              if (!value) return
              setReply('')
              onStart(value)
            }}
          >
            <label className="oslaw__research-label" htmlFor="penumbra-research-reply">
              Your response
            </label>
            <textarea
              id="penumbra-research-reply"
              className="oslaw__research-input"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              rows={3}
              maxLength={3000}
              placeholder="Add facts for this exploratory research thread"
            />
            <button type="submit" className="oslaw__btn" disabled={!reply.trim() || busy}>
              Continue research
            </button>
            <button
              type="button"
              className="oslaw__btn"
              disabled={busy}
              onClick={() => onStart('No additional information is available. Skip this question and continue using the current facts.')}
            >
              Skip this question
            </button>
          </form>
        </div>
      ) : null}

      {hasFindings ? (
        <div className="oslaw__research-findings">
          <p className="oslaw__rec-note">
            {research?.bundle?.sources.length || 0} canonical sources · {research?.bundle?.claims.length || 0} linked claims
            {' '}· {research?.bundle?.freeResources.length || 0} free-resource leads queued for review
          </p>
          {research?.bundle?.matching ? (
            <p className="oslaw__rec-note">
              Matching lens: <strong>{research.bundle.matching.matterType}</strong> · {research.bundle.matching.topicId}
              {' '}({research.bundle.matching.confidence}) — {research.bundle.matching.rationale}
            </p>
          ) : null}
          {research?.bundle?.sources.length ? (
            <details className="oslaw__rec-sources">
              <summary>Sources, provenance and tiers</summary>
              <ul className="oslaw__rec-list--links">
                {research.bundle.sources.map((source) => (
                  <li key={source.id}>
                    {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}
                    <span>
                      {' '}
                      — {source.origin === 'external' ? 'external · unverified' : 'curated'} · {source.tier}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {research?.bundle?.claims.length ? (
            <ul className="oslaw__rec-list">
            {research.bundle.claims.map((claim) => (
                <li key={claim.claim}>
                  {claim.claim} <span>({claim.confidence}; {claim.sourceIds.join(', ')})</span>
                </li>
              ))}
            </ul>
          ) : null}
          {research?.bundle?.conflicts.length ? (
            <p className="oslaw__rec-note">Conflicts to check: {research.bundle.conflicts.join(' · ')}</p>
          ) : null}
          <button type="button" className="oslaw__btn oslaw__btn--primary" onClick={onUseFindings}>
            Ask Legal Shaman to review these findings
          </button>
        </div>
      ) : null}
    </section>
  )
}

export function OslawView({
  session,
  frames = [],
  masterAnswerPackage = null,
  overviewLoading = false,
  onBack,
  onFindHelp,
  onFollowUp,
  searchMode,
  onStartPenumbraResearch,
  onUsePenumbraResearch,
  pageNavigation,
}: Props) {
  const frameKey = frames.map((frame) => frame.id).join('|')
  const overviewKey = [
    session.rawInputs.join('|'),
    session.whatHappened,
    session.howCaused,
    session.goal,
    session.clientQuestion,
    session.topicId,
    session.searchMode,
    session.reformulationOutcome,
  ].join('¦')
  const basePack = useMemo(
    () =>
      buildAnswerPackage(session, frames, {
        researchBundle: session.penumbraResearch?.bundle,
      }),
    [overviewKey, frameKey, session.penumbraResearch?.bundle, session.penumbraResearch?.updatedAt],
  )
  const [pack, setPack] = useState<AnswerPackage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([])
  const mountedAt = useRef(Date.now())
  const previousMode = useRef(searchMode)

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
    const modeChanged = previousMode.current !== searchMode
    previousMode.current = searchMode

    void (async () => {
      const course = await matchOslawCourse(session, frames)
      if (cancelled) return

      let retrieved: AnswerPackage | null = null
      if (!basePack.matchedTopicId || searchMode === 'penumbra' || modeChanged) {
        const res = await fetchRetrieveAnswer(
          session,
          frames,
          undefined,
          session.penumbraResearch?.bundle,
        )
        if (cancelled) return
        retrieved = res?.answerPackage ?? null
      }

      const candidate = pickBestPack(
        basePack,
        isFinalOverviewPackage(masterAnswerPackage) ? masterAnswerPackage : null,
        retrieved,
        searchMode,
        modeChanged,
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
  }, [overviewKey, frameKey, masterAnswerPackage, overviewLoading, basePack, searchMode])

  const blockedPathway = preflightIssues.some((i) => i.severity === 'block-pathway')
  const preflightNote = blockedPathway
    ? 'Some wiki pathways were withheld after a pre-display check (topic mismatch).'
    : preflightIssues.some((i) => i.severity === 'drop-url')
      ? 'Some links were removed after a liveness check.'
      : null

  const ready = Boolean(pack && (pack.answerOverview.trim() || pack.bullets.length > 0))

  return (
    <div className="oslaw">
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
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

      <section className="oslaw__mode" aria-labelledby="oslaw-mode-title">
        <div>
          <h2 id="oslaw-mode-title" className="oslaw__mode-title">
            Research mode: Third Eye
          </h2>
          <p className="oslaw__mode-copy">
            Curated Legal Shaman sources first, followed by broader exploratory research with source quality and uncertainty labelled.
          </p>
        </div>
        <p className="oslaw__mode-risk">
          The Shaman is supplemental research only. Legal Shaman retains final synthesis, matching help and safety checks.
        </p>
      </section>

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
            onFollowUp={onFollowUp}
          />
          <PenumbraResearchPanel
            session={session}
            onStart={onStartPenumbraResearch}
            onUseFindings={onUsePenumbraResearch}
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
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
    </div>
  )
}
