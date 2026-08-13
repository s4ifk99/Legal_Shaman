import { useEffect, useState } from 'react'
import type { SessionState } from '@/lib/coherence/types'
import type { LegalFrame } from '@/lib/coherence/frames'
import type { AnswerPackage } from '@/lib/coherence/answerPackage'
import {
  fetchRetrieveAnswer,
  isFinalOverviewPackage,
} from '@/lib/coherence/retrieveAnswer'
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

function Recommendation({ pack }: { pack: AnswerPackage }) {
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

      {takeaways.length > 0 && (
        <section className="oslaw__rec-section">
          <h3 className="oslaw__rec-h">Key takeaways</h3>
          <ul className="oslaw__rec-list">
            {takeaways.map((b, i) => (
              <li key={`${i}-${b.text.slice(0, 24)}`}>{b.text}</li>
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

export function OslawView({
  session,
  frames = [],
  masterAnswerPackage = null,
  overviewLoading = false,
  onBack,
  onFindHelp,
}: Props) {
  const masterFinal = isFinalOverviewPackage(masterAnswerPackage)
  const [pack, setPack] = useState<AnswerPackage | null>(masterFinal ? masterAnswerPackage : null)
  const [loading, setLoading] = useState(overviewLoading || !masterFinal)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (overviewLoading) {
      setPack(null)
      setLoading(true)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    if (isFinalOverviewPackage(masterAnswerPackage)) {
      setPack(masterAnswerPackage)
      setLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    setPack(null)
    setLoading(true)
    setError(null)

    void (async () => {
      const retrieved = await fetchRetrieveAnswer(session, frames)
      if (cancelled) return
      const next = retrieved?.answerPackage ?? null
      if (isFinalOverviewPackage(next)) {
        setPack(next)
        setError(null)
      } else {
        setPack(null)
        setError('Could not build a wiki-grounded recommendation for this story yet.')
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [session, frames, masterAnswerPackage, overviewLoading])

  const ready = isFinalOverviewPackage(pack)

  return (
    <div className="oslaw">
      <header className="oslaw__header">
        <button type="button" className="oslaw__back" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1 className="oslaw__title">Overview</h1>
          <p className="oslaw__lead">Practical signposting from the Legal Shaman wiki — not legal advice.</p>
        </div>
      </header>

      {loading && (
        <p className="oslaw__status">
          {overviewLoading
            ? 'Synthesising your recommendation from wiki sources…'
            : 'Building recommendation from wiki sources…'}
        </p>
      )}

      {!loading && ready && pack && (
        <div className="oslaw__body">
          <Recommendation pack={pack} />
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
