import { useEffect, useState } from 'react'
import {
  fetchSraOrganisation,
  parseWorkAreas,
  type SraOrganisation,
} from '@/lib/coherence/sraOrganisation'
import { fetchSraComments, postSraComment, type SraComment } from '@/lib/coherence/sraComments'
import { SraAttribution } from '@/components/sra-attribution'
import './SraOrganisationView.css'

interface Props {
  sraId: string
  onBack: () => void
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function SraOrganisationView({ sraId, onBack }: Props) {
  const [org, setOrg] = useState<SraOrganisation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState<SraComment[]>([])
  const [commentsShared, setCommentsShared] = useState(true)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [authorName, setAuthorName] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setCommentsLoading(true)
    setError(null)
    setCommentsError(null)
    void (async () => {
      const [next, commentPack] = await Promise.all([
        fetchSraOrganisation(sraId),
        fetchSraComments(sraId),
      ])
      if (cancelled) return
      if (!next) {
        setError('Could not load this organisation from the SRA register.')
        setOrg(null)
      } else {
        setOrg(next)
      }
      setComments(commentPack.comments)
      setCommentsShared(commentPack.shared)
      setCommentsError(commentPack.shared ? null : commentPack.error ?? null)
      setLoading(false)
      setCommentsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [sraId])

  async function submitComment(event: React.FormEvent) {
    event.preventDefault()
    const body = message.trim()
    if (!body || submitting) return
    setSubmitting(true)
    setCommentsError(null)
    const result = await postSraComment(sraId, authorName, body)
    setComments((prev) => [result.comment, ...prev])
    setCommentsShared(result.shared)
    if (!result.shared && result.error) {
      setCommentsError(`Saved on this device only (${result.error}).`)
    }
    setMessage('')
    setSubmitting(false)
  }

  const workAreas = org ? parseWorkAreas(org.workArea) : []
  const address = org
    ? [org.city, org.county, org.postcode, org.country].filter(Boolean).join(' · ')
    : ''

  return (
    <div className="sra-org">
      <header className="sra-org__header">
        <button type="button" className="sra-org__back" onClick={onBack}>
          ← Back to matching help
        </button>
        <p className="sra-org__eyebrow">SRA-regulated organisation</p>
        {loading ? (
          <h1 className="sra-org__title">Loading…</h1>
        ) : org ? (
          <h1 className="sra-org__title">{org.name}</h1>
        ) : (
          <h1 className="sra-org__title">Organisation not found</h1>
        )}
        {org && <p className="sra-org__meta">SRA ID {org.sraId}</p>}
      </header>

      {loading ? (
        <p className="sra-org__lead">Fetching register details…</p>
      ) : error ? (
        <p className="sra-org__lead">{error}</p>
      ) : org ? (
        <>
          <section className="sra-org__section">
            <h2 className="sra-org__section-title">Contact &amp; location</h2>
            <dl className="sra-org__details">
              {address && (
                <>
                  <dt>Address</dt>
                  <dd>{address}</dd>
                </>
              )}
              {org.phone && (
                <>
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${org.phone.replace(/\s/g, '')}`}>{org.phone}</a>
                  </dd>
                </>
              )}
              {org.email && (
                <>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${org.email}`}>{org.email}</a>
                  </dd>
                </>
              )}
              {org.website && (
                <>
                  <dt>Website</dt>
                  <dd>
                    <a href={org.website} target="_blank" rel="noreferrer">
                      {org.website.replace(/^https?:\/\//, '')}
                    </a>
                  </dd>
                </>
              )}
              {org.authorisationStatus && (
                <>
                  <dt>Authorisation</dt>
                  <dd>{org.authorisationStatus}</dd>
                </>
              )}
            </dl>
          </section>

          {workAreas.length > 0 && (
            <section className="sra-org__section">
              <h2 className="sra-org__section-title">Practice areas</h2>
              <ul className="sra-org__areas">
                {workAreas.map((area) => (
                  <li key={area}>{area}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="sra-org__section">
            <h2 className="sra-org__section-title">Comments</h2>
            <p className="sra-org__lead">
              {commentsShared
                ? 'Share your experience for others researching this firm. Comments are stored on our server — not legal advice.'
                : 'Comments are saved on this device only right now (database unreachable). They will sync when the server is back.'}
            </p>
            {commentsError && <p className="sra-org__warn">{commentsError}</p>}
            <form className="sra-org__comment-form" onSubmit={submitComment}>
              <label className="sra-org__label">
                Your name (optional)
                <input
                  className="sra-org__input"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Anonymous"
                  maxLength={80}
                  disabled={submitting}
                />
              </label>
              <label className="sra-org__label">
                Message
                <textarea
                  className="sra-org__textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. Took my consumer case, clear on fees…"
                  rows={4}
                  maxLength={2000}
                  required
                  disabled={submitting}
                />
              </label>
              <button type="submit" className="sra-org__submit" disabled={!message.trim() || submitting}>
                {submitting ? 'Posting…' : 'Post comment'}
              </button>
            </form>
            {commentsLoading ? (
              <p className="sra-org__empty">Loading comments…</p>
            ) : comments.length === 0 ? (
              <p className="sra-org__empty">No comments yet — be the first.</p>
            ) : (
              <ul className="sra-org__comments">
                {comments.map((c) => (
                  <li key={c.id} className="sra-org__comment">
                    <div className="sra-org__comment-head">
                      <strong>{c.authorName}</strong>
                      <time dateTime={c.createdAt}>{formatWhen(c.createdAt)}</time>
                    </div>
                    <p>{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {org.profileUrl && (
            <p className="sra-org__verify">
              <a href={org.profileUrl} target="_blank" rel="noreferrer">
                Verify on the official SRA register →
              </a>
            </p>
          )}
        </>
      ) : null}

      {org ? <SraAttribution className="sra-org__sra-attribution" /> : null}

      <p className="sra-org__note">
        Register data from the synced SRA organisations database. Not a recommendation. Verify regulation
        and suitability yourself.
      </p>
    </div>
  )
}
