import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionState } from '@/lib/coherence/types'
import {
  briefToJsonDownload,
  briefToPlainText,
  buildLawyerBrief,
  buildSolicitorBrief,
  type SolicitorBriefV0,
} from '@/lib/coherence/brief'
import type { FrameFit } from '@/lib/coherence/coherence'
import { maximiseLocalCoherence, wikiHitsToCandidates } from '@/lib/coherence/coherence'
import type { LegalFrame } from '@/lib/coherence/frames'
import { proposeLegalFrames } from '@/lib/coherence/frames'
import {
  applyReviewToBrief,
  computeReviewSummary,
  goldToJsonDownload,
  persistReviewAsGold,
  seedReviewFromBrief,
  type LawyerReviewRecord,
} from '@/lib/coherence/lawyerLoop'
import { queueHandoff } from '@/lib/coherence/lawyerInbox'
import {
  clearShareHandle,
  loadShareHandle,
  saveShareHandle,
  shareNotesUrl,
  shareNotesPath,
  tokenFromShareUrl,
  type ChronologyShareHandle,
} from '@/lib/coherence/share/local'
import { sourcesByFrame, wikiHitsToSignposts, matchImmigrationWiki } from '@/lib/coherence/wiki'
import { isImmigrationSession } from '@/lib/coherence/services'
import { LawyerReview } from './LawyerReview'
import { PageNavigation, type PageNavigationProps } from './PageNavigation'
import './LawyerNotes.css'

interface Props {
  session: SessionState
  progress: number
  frames?: LegalFrame[]
  /** Open the print / Save as PDF dialog once on mount */
  autoDownload?: boolean
  /**
   * `client` — lay visitor handoff (no Phase 4 review).
   * `lawyer` — signed-in solicitor portal only.
   */
  audience?: 'client' | 'lawyer'
  lawyerName?: string
  /** When reviewing an imported Phase 0 JSON, use it as the brief base. */
  importedBrief?: SolicitorBriefV0
  onBack: () => void
  pageNavigation?: PageNavigationProps
}

export function LawyerNotes({
  session,
  progress,
  frames = [],
  autoDownload = false,
  audience = 'client',
  lawyerName,
  importedBrief,
  onBack,
  pageNavigation,
}: Props) {
  const isLawyer = audience === 'lawyer'
  const printRef = useRef<HTMLElement>(null)
  const briefIdRef = useRef(
    importedBrief?.brief_id ||
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `brief-${Date.now()}`),
  )
  const [wikiOpts, setWikiOpts] = useState<{
    sourcesByFrame?: Record<
      string,
      { title: string; url_or_id: string; jurisdiction: string; snippet: string }[]
    >
    signposts?: SolicitorBriefV0['signposts_shown_to_client']
    frameFits?: FrameFit[]
    rankedFrames?: LegalFrame[]
    conflictsDetected?: SolicitorBriefV0['conflicts_detected']
  }>({})
  const [review, setReview] = useState<LawyerReviewRecord | null>(null)
  const [goldSavedAt, setGoldSavedAt] = useState<string | null>(null)
  const [sharedAt, setSharedAt] = useState<string | null>(null)
  const [consentToShare, setConsentToShare] = useState(false)
  const [shareHandle, setShareHandle] = useState<ChronologyShareHandle | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareMessage, setShareMessage] = useState<string | null>(null)

  const displayFrames = wikiOpts.rankedFrames?.length ? wikiOpts.rankedFrames : frames

  const brief = useMemo(
    () => buildLawyerBrief(session, progress, displayFrames),
    [session, progress, displayFrames],
  )
  const solicitorBrief = useMemo(() => {
    if (importedBrief) return importedBrief
    return buildSolicitorBrief(session, progress, displayFrames, {
      briefId: briefIdRef.current,
      sourcesByFrame: wikiOpts.sourcesByFrame,
      signposts: wikiOpts.signposts,
      frameFits: wikiOpts.frameFits,
      conflictsDetected: wikiOpts.conflictsDetected,
      corpusVersion: 'immigrationWiki.json',
      consentToShare,
    })
  }, [session, progress, displayFrames, wikiOpts, importedBrief, consentToShare])
  const plain = useMemo(() => briefToPlainText(brief), [brief])

  const reviewedBrief = useMemo(
    () => (isLawyer && review ? applyReviewToBrief(solicitorBrief, review) : solicitorBrief),
    [solicitorBrief, review, isLawyer],
  )

  // Phase 4 review seeds only for signed-in solicitors
  useEffect(() => {
    if (!isLawyer) {
      setReview(null)
      return
    }
    setReview((prev) => {
      const next = seedReviewFromBrief(solicitorBrief)
      if (!prev || prev.brief_id !== solicitorBrief.brief_id) return next
      const prevIds = prev.corrections.map((c) => c.field_id).join('|')
      const nextIds = next.corrections.map((c) => c.field_id).join('|')
      if (prevIds === nextIds) return prev
      const byId = new Map(prev.corrections.map((c) => [c.field_id, c]))
      const corrections = next.corrections.map((c) => byId.get(c.field_id) ?? c)
      return {
        ...next,
        corrections,
        summary: computeReviewSummary(corrections),
        updated_at: new Date().toISOString(),
      }
    })
  }, [solicitorBrief, isLawyer])

  useEffect(() => {
    if (importedBrief) return
    let cancelled = false
    if (!isImmigrationSession(session)) {
      const proposed = frames.length ? frames : proposeLegalFrames(session, 5)
      const pass = maximiseLocalCoherence(session, proposed, [], 3)
      setWikiOpts({
        frameFits: pass.fits,
        rankedFrames: pass.frames,
        conflictsDetected: pass.conflictsDetected.map((c) => ({
          description: c.description,
          resolution: c.resolution,
          note: c.note,
          timeline_orders: [],
        })),
      })
      return
    }
    void (async () => {
      const proposed = frames.length > 0 ? frames : proposeLegalFrames(session, 5)
      const probe = await matchImmigrationWiki(session, proposed, 8)
      if (cancelled) return
      const candidates = wikiHitsToCandidates(probe)
      const pass = maximiseLocalCoherence(session, proposed, candidates, 3)
      const ranked = pass.frames.length ? pass.frames : proposed
      const [byFrame, hits] = await Promise.all([
        sourcesByFrame(session, ranked, 3),
        matchImmigrationWiki(session, ranked, 6),
      ])
      if (cancelled) return
      setWikiOpts({
        sourcesByFrame: byFrame,
        signposts: wikiHitsToSignposts(hits),
        frameFits: pass.fits,
        rankedFrames: ranked,
        conflictsDetected: pass.conflictsDetected.map((c) => ({
          description: c.description,
          resolution: c.resolution,
          note: c.note,
          timeline_orders: [],
        })),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [session, frames, importedBrief])

  function downloadPdf() {
    window.print()
  }

  function downloadJson() {
    const payload =
      isLawyer && review ? applyReviewToBrief(solicitorBrief, review) : solicitorBrief
    const json = briefToJsonDownload(
      payload,
      isLawyer && review ? review : undefined,
    )
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${payload.brief_id || 'solicitor-brief'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function saveGold() {
    if (!isLawyer || !review) return
    const store = persistReviewAsGold(review)
    setGoldSavedAt(new Date().toISOString())
    const json = goldToJsonDownload(store)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lawyer-gold-${review.brief_id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    setShareHandle(loadShareHandle(briefIdRef.current))
  }, [])

  function shareToInbox() {
    queueHandoff(solicitorBrief, 'client_share', 'Shared from client notes')
    setSharedAt(new Date().toISOString())
  }

  async function publishShare() {
    if (!consentToShare) {
      setShareMessage('Confirm consent before creating a shareable link.')
      return
    }
    setShareBusy(true)
    setShareMessage(null)
    try {
      const res = await fetch('/api/coherence/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent: true,
          brief: solicitorBrief,
          updateSecret: shareHandle?.updateSecret,
          knownPathToken: shareHandle?.token || (shareHandle ? tokenFromShareUrl(shareHandle.url) : undefined),
        }),
      })
      const data = (await res.json()) as {
        error?: string
        url?: string
        updateSecret?: string
        expiresAt?: string
        publishedAt?: string
      }
      if (!res.ok || !data.url || !data.updateSecret || !data.expiresAt || !data.publishedAt) {
        setShareMessage(data.error || 'Could not create a shareable link.')
        return
      }
      const token = tokenFromShareUrl(data.url) || shareHandle?.token || ''
      if (!token) {
        setShareMessage('Could not create a shareable link.')
        return
      }
      const handle: ChronologyShareHandle = {
        briefId: solicitorBrief.brief_id,
        url: shareNotesUrl(window.location.origin, token),
        token,
        updateSecret: data.updateSecret,
        expiresAt: data.expiresAt,
        publishedAt: data.publishedAt,
      }
      saveShareHandle(handle)
      setShareHandle(handle)
      await navigator.clipboard?.writeText(handle.url)
      setShareMessage('Link copied. Anyone with the URL can view these notes until you revoke it or it expires.')
    } catch {
      setShareMessage('Could not create a shareable link.')
    } finally {
      setShareBusy(false)
    }
  }

  async function revokePublishedShare() {
    if (!shareHandle) return
    setShareBusy(true)
    setShareMessage(null)
    try {
      const token = tokenFromShareUrl(shareHandle.url) || shareHandle.token
      const res = await fetch(`/api/coherence/share/${encodeURIComponent(token)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updateSecret: shareHandle.updateSecret }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setShareMessage(data.error || 'Could not revoke the link.')
        return
      }
      clearShareHandle(shareHandle.briefId)
      setShareHandle(null)
      setShareMessage('Share link revoked.')
    } catch {
      setShareMessage('Could not revoke the link.')
    } finally {
      setShareBusy(false)
    }
  }

  useEffect(() => {
    if (!autoDownload) return
    const t = window.setTimeout(() => window.print(), 400)
    return () => window.clearTimeout(t)
  }, [autoDownload])

  function emailNotes() {
    const subject = encodeURIComponent(
      brief.ready ? 'Notes for your Lawyer — Legal Shaman intake' : 'DRAFT Notes for your Lawyer — Legal Shaman',
    )
    const body = encodeURIComponent(plain)
    const max = 1800
    const clipped = body.length > max ? `${body.slice(0, max)}%0A%0A%5BTruncated — download PDF for full notes%5D` : body
    window.location.href = `mailto:?subject=${subject}&body=${clipped}`
  }

  function copyNotes() {
    void navigator.clipboard?.writeText(plain)
  }

  const decided = review
    ? review.summary.accepted + review.summary.edited + review.summary.rejected
    : 0

  const displaySummary = isLawyer ? reviewedBrief.matter_summary_plain : brief.situationSummary
  const displayGoal = isLawyer ? reviewedBrief.client_goal.stated : brief.desiredOutcome
  const displayIssues = isLawyer
    ? reviewedBrief.issues.map((issue) => ({
        id: issue.id,
        rank: issue.rank,
        label: issue.plain_label,
        why: issue.why_this_frame.join('; '),
      }))
    : brief.issues
  const displayTimeline = isLawyer
    ? reviewedBrief.timeline.map((row) => ({
        order: row.order,
        when: row.date_approx || 'Date not given',
        event: row.event,
        inferred: !row.client_confirmed,
        actors: row.actors,
      }))
    : brief.timeline.map((row) => ({
        order: row.order,
        when: row.when,
        event: row.event,
        inferred: !row.clientConfirmed,
        actors: row.actors,
      }))
  const displaySources = isLawyer ? reviewedBrief.issues : solicitorBrief.issues
  const displayConflicts = isLawyer
    ? reviewedBrief.conflicts_detected
    : solicitorBrief.conflicts_detected
  const displayNarrative = (
    isLawyer ? reviewedBrief.client_narrative_raw || brief.clientNarrativeRaw : brief.clientNarrativeRaw
  ).trim()

  return (
    <div className="notes">
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
      <header className="notes__chrome no-print">
        <button type="button" className="notes__back" onClick={onBack}>
          {isLawyer ? '← Back' : '← Back to timeline'}
        </button>
        <div className="notes__actions">
          <button type="button" className="notes__btn" onClick={copyNotes}>
            Copy text
          </button>
          <button type="button" className="notes__btn" onClick={emailNotes}>
            Email
          </button>
          {!isLawyer && (
            <button type="button" className="notes__btn" onClick={shareToInbox}>
              Local inbox (this browser)
            </button>
          )}
          {isLawyer && (
            <button
              type="button"
              className="notes__btn"
              onClick={saveGold}
              disabled={!review || decided === 0}
              title={decided === 0 ? 'Mark at least one field first' : 'Save corrections as gold'}
            >
              Save gold
            </button>
          )}
          <button type="button" className="notes__btn" onClick={downloadJson}>
            Download JSON
          </button>
          <button type="button" className="notes__btn notes__btn--solid" onClick={downloadPdf}>
            Download PDF
          </button>
        </div>
      </header>

      {isLawyer && (
        <p className="notes__draft-banner no-print" role="status">
          Solicitor review{lawyerName ? ` · ${lawyerName}` : ''} — not visible to the client.
        </p>
      )}

      {!isLawyer && !brief.ready && (
        <p className="notes__draft-banner no-print" role="status">
          Draft — still gathering information. These notes will strengthen as you answer more prompts.
        </p>
      )}
      {!isLawyer && brief.ready && !brief.readyForSolicitor && (
        <p className="notes__draft-banner no-print" role="status">
          Nearly ready — confirm jurisdiction, goal, and timeline before treating this as a solicitor handoff.
        </p>
      )}
      {autoDownload && (
        <p className="notes__draft-banner no-print" role="status">
          Opening print / Save as PDF so you can download a copy of your notes and timeline for a solicitor.
        </p>
      )}
      {sharedAt && !isLawyer && (
        <p className="notes__draft-banner no-print" role="status">
          Queued in this browser for solicitors signed into Legal Shaman (
          {new Date(sharedAt).toLocaleString('en-GB')}).
        </p>
      )}
      {!isLawyer && (
        <section className="notes__share no-print" aria-label="Shareable lawyer link">
          <h2>Shareable link for a lawyer</h2>
          {session.events.filter((e) => e.kind === 'event').length < 2 && (
            <p className="notes__share-warn">
              Chronology is thin. Add more dated events before sending this to a solicitor if you can.
            </p>
          )}
          <label className="notes__consent">
            <input
              type="checkbox"
              checked={consentToShare}
              onChange={(e) => setConsentToShare(e.target.checked)}
            />
            <span>
              I understand this link lets anyone with the URL see my notes until it expires or I
              revoke it.
            </span>
          </label>
          <div className="notes__share-actions">
            <button
              type="button"
              className="notes__btn notes__btn--solid"
              onClick={() => void publishShare()}
              disabled={shareBusy || !consentToShare}
            >
              {shareHandle ? 'Update shared view' : 'Create shareable link'}
            </button>
            {shareHandle && (
              <button
                type="button"
                className="notes__btn"
                onClick={() => void navigator.clipboard?.writeText(shareHandle.url)}
              >
                Copy link
              </button>
            )}
            {shareHandle && (
              <button
                type="button"
                className="notes__btn"
                onClick={() => void revokePublishedShare()}
                disabled={shareBusy}
              >
                Revoke
              </button>
            )}
          </div>
          {shareHandle && (
            <p className="notes__share-url">
              <a href={shareNotesPath(shareHandle.token)} target="_blank" rel="noreferrer">
                {shareHandle.url}
              </a>
              <br />
              Expires {new Date(shareHandle.expiresAt).toLocaleString('en-GB')} · last published{' '}
              {new Date(shareHandle.publishedAt).toLocaleString('en-GB')}
            </p>
          )}
          {shareMessage && <p className="notes__share-status">{shareMessage}</p>}
        </section>
      )}
      {isLawyer && goldSavedAt && (
        <p className="notes__draft-banner no-print" role="status">
          Gold corrections saved locally ({new Date(goldSavedAt).toLocaleString('en-GB')}). Edit distance:{' '}
          {review?.summary.edit_distance.toFixed(2) ?? '—'}
        </p>
      )}

      {brief.urgentHelpCopy && (
        <p className="notes__urgent no-print" role="alert">
          {brief.urgentHelpCopy}
        </p>
      )}

      {isLawyer && review && <LawyerReview review={review} onChange={setReview} />}

      <article ref={printRef} className="notes__sheet" aria-label="Notes for your Lawyer">
        <h1 className="notes__title">{brief.title}</h1>
        <p className="notes__meta">
          {new Date(brief.createdAt).toLocaleString('en-GB')}
          {' · '}
          {brief.readyForSolicitor ? 'Solicitor-ready' : brief.ready ? 'Review draft' : 'Draft'}
          {' · '}
          {brief.matterType}
          {' · '}
          {brief.jurisdiction}
          {' · '}
          Risk: {brief.riskRouting}
          {isLawyer && review && decided > 0
            ? ` · Lawyer marks ${decided}/${review.summary.total}`
            : ''}
        </p>

        <section className="notes__section">
          <h2>Desired outcome</h2>
          <p>{displayGoal}</p>
        </section>

        {displayNarrative ? (
          <section className="notes__section">
            <h2>In the client’s words</h2>
            <p className="notes__raw">{displayNarrative}</p>
          </section>
        ) : null}

        <section className="notes__section">
          <h2>Chronology</h2>
          {displayTimeline.length === 0 ? (
            <p className="notes__empty">No timeline events captured yet.</p>
          ) : (
            <ol className="notes__timeline">
              {displayTimeline.map((row) => (
                <li key={row.order}>
                  <span className="notes__when">{row.when}</span>
                  <span className="notes__event">{row.event}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="notes__section">
          <h2>Situation summary</h2>
          <p>{displaySummary}</p>
        </section>

        {displayIssues.length > 0 && (
          <section className="notes__section">
            <h2>Issues (ranked hypotheses)</h2>
            <ul>
              {displayIssues.map((issue) => {
                const fit = wikiOpts.frameFits?.find((f) => f.frameId === issue.id)
                return (
                  <li key={issue.id}>
                    <strong>
                      [{issue.rank}] {issue.label}
                    </strong>
                    {fit ? ` · fit ${fit.fitScore}` : ''} — {issue.why}
                    {fit && fit.unmetConstraints.length > 0 && (
                      <ul>
                        {fit.unmetConstraints.map((u) => (
                          <li key={u}>Unmet: {u}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {displaySources.some((i) => i.candidate_sources.length > 0) && (
          <section className="notes__section">
            <h2>Candidate sources (wiki)</h2>
            <ul>
              {displaySources.flatMap((issue) =>
                issue.candidate_sources.map((s) => (
                  <li key={`${issue.id}-${s.url_or_id}`}>
                    <strong>{issue.plain_label}:</strong> {s.title}{' '}
                    <span className="notes__when">
                      ({s.jurisdiction} · {s.url_or_id})
                    </span>
                    {s.snippet ? ` — ${s.snippet}` : ''}
                  </li>
                )),
              )}
            </ul>
          </section>
        )}

        {displayConflicts.length > 0 && (
          <section className="notes__section">
            <h2>Conflicts / tensions (unresolved)</h2>
            <ul>
              {displayConflicts.map((c) => (
                <li key={c.description}>{c.description}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="notes__section">
          <h2>Instructions for the lawyer</h2>
          <p>{brief.instructionsForLawyer}</p>
        </section>

        {(brief.parties.length > 0 || brief.documents.length > 0) && (
          <section className="notes__section">
            <h2>People & documents</h2>
            {brief.parties.length > 0 && (
              <p>
                <strong>Parties:</strong> {brief.parties.join('; ')}
              </p>
            )}
            {brief.documents.length > 0 && (
              <p>
                <strong>Documents mentioned:</strong> {brief.documents.join('; ')}
              </p>
            )}
          </section>
        )}

        {brief.openQuestions.length > 0 && (
          <section className="notes__section">
            <h2>Open questions</h2>
            <ul>
              {brief.openQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </section>
        )}

        {brief.urgentHelpCopy && (
          <section className="notes__section">
            <h2>Urgent help</h2>
            <p>{brief.urgentHelpCopy}</p>
          </section>
        )}

        <p className="notes__disclaimer">{brief.disclaimer}</p>
      </article>
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
    </div>
  )
}
