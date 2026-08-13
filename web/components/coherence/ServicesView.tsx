import { useEffect, useMemo, useState } from 'react'
import type { SessionState } from '@/lib/coherence/types'
import type { LegalFrame } from '@/lib/coherence/frames'
import {
  buildHelpPack,
  matterLabel,
  type HelpPack,
} from '@/lib/coherence/services'
import type { HelpMatchResult } from '@/lib/coherence/masterAgent'
import { buildLawyerBrief, briefToPlainText } from '@/lib/coherence/brief'
import { computeProgress } from '@/lib/coherence/slots'
import { SraAttribution } from '@/components/sra-attribution'
import './ServicesView.css'

interface Props {
  session: SessionState
  frames?: LegalFrame[]
  helpMatch?: HelpMatchResult | null
  onBack: () => void
  onOpenSraFirm?: (sraId: string) => void
}

type Row = {
  id: string
  type: string
  title: string
  blurb: string
  url?: string
  phone?: string
  sraId?: string
  section?: string
  score?: number
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '')
  if (digits.startsWith('44') && digits.length >= 12) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  return phone.trim()
}

function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '')
  if (!cleaned) return ''
  if (cleaned.startsWith('+')) return `tel:${cleaned}`
  if (cleaned.startsWith('0')) return `tel:+44${cleaned.slice(1)}`
  return `tel:${cleaned}`
}

function Item({ s, onOpenSraFirm }: { s: Row; onOpenSraFirm?: (sraId: string) => void }) {
  const phone = (s.phone || '').trim()
  const tel = phone ? telHref(phone) : ''

  return (
    <li className="services__item">
      <div className="services__type">{s.type}</div>
      <h3 className="services__name">{s.title}</h3>
      {s.blurb && <p className="services__blurb">{s.blurb}</p>}
      {phone ? (
        <p className="services__phone">
          <span className="services__phone-label">Phone</span>
          {tel ? (
            <a className="services__phone-link" href={tel}>
              {formatPhoneDisplay(phone)}
            </a>
          ) : (
            <span className="services__phone-link">{formatPhoneDisplay(phone)}</span>
          )}
        </p>
      ) : s.sraId ? (
        <p className="services__phone services__phone--missing">Phone not listed on SRA register</p>
      ) : null}
      <div className="services__actions">
        {s.sraId && onOpenSraFirm ? (
          <button
            type="button"
            className="services__link services__link--button"
            onClick={() => onOpenSraFirm(s.sraId!)}
          >
            View firm profile →
          </button>
        ) : null}
        {s.url ? (
          <a className="services__link" href={s.url} target="_blank" rel="noreferrer">
            Open link →
          </a>
        ) : null}
      </div>
    </li>
  )
}

function Section({
  title,
  lead,
  rows,
  onOpenSraFirm,
  variant,
}: {
  title: string
  lead?: string
  rows: Row[]
  onOpenSraFirm?: (sraId: string) => void
  variant?: 'free'
}) {
  if (!rows.length) return null
  return (
    <section
      className={['services__section', variant === 'free' ? 'services__section--free' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <h2 className="services__section-title">{title}</h2>
      {lead ? <p className="services__section-lead">{lead}</p> : null}
      <ul className="services__list">
        {rows.map((s) => (
          <Item key={s.id} s={s} onOpenSraFirm={onOpenSraFirm} />
        ))}
      </ul>
    </section>
  )
}

function ShareWithSolicitorPanel({
  session,
  frames,
}: {
  session: SessionState
  frames: LegalFrame[]
}) {
  const [copied, setCopied] = useState(false)
  const progress = useMemo(() => computeProgress(session), [session])
  const brief = useMemo(
    () => buildLawyerBrief(session, progress, frames),
    [session, progress, frames],
  )
  const shareText = useMemo(() => briefToPlainText(brief), [brief])

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const timelineRows =
    brief.timeline.length > 0
      ? brief.timeline
      : session.whatHappened
        ? [{ order: 1, when: 'Account', event: session.whatHappened }]
        : []

  return (
    <aside className="services__share" aria-label="Share with a solicitor">
      <h2 className="services__share-title">Share with a solicitor</h2>
      <p className="services__share-lead">
        Copy this summary when you contact a firm. It opens with a note that you were recommended by
        LegalShaman.com.
      </p>

      <div className="services__share-card">
        <p className="services__share-badge">Recommended by LegalShaman.com</p>
        <p className="services__share-summary">{brief.situationSummary}</p>

        <h3 className="services__share-heading">Timeline</h3>
        {timelineRows.length === 0 ? (
          <p className="services__share-empty">No timeline events yet — add detail on the intake screen.</p>
        ) : (
          <ol className="services__share-timeline">
            {timelineRows.map((row) => (
              <li key={`${row.order}-${row.when}`}>
                <span className="services__share-when">{row.when}</span>
                <span className="services__share-event">{row.event}</span>
              </li>
            ))}
          </ol>
        )}

        <h3 className="services__share-heading">Desired outcome</h3>
        <p className="services__share-outcome">{brief.desiredOutcome}</p>

        <h3 className="services__share-heading">Instructions for the solicitor</h3>
        <p className="services__share-instructions">{brief.instructionsForLawyer}</p>

        <button type="button" className="services__share-copy" onClick={() => void copyShare()}>
          {copied ? 'Copied' : 'Copy summary for solicitor'}
        </button>
      </div>
    </aside>
  )
}

function normKey(title: string, url?: string): string {
  const host = (url || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
    .toLowerCase()
    .split(/[?#]/)[0]
  const name = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return host ? `${name}|${host}` : name
}

/** Prefer matter-specific free help; drop weak / off-topic Getting Help noise. */
function isRelevantFreeHelp(row: Row, session: SessionState): boolean {
  const matter = session.matterType
  const hay = `${row.title} ${row.blurb} ${row.section || ''} ${row.type}`.toLowerCase()
  const story = [...session.rawInputs, session.whatHappened, session.goal]
    .join(' ')
    .toLowerCase()

  if (/therap|counsell|intercultural|wellbeing|well-being|psycholog/.test(hay) && !/trauma|mental|abuse/.test(story)) {
    return false
  }

  if (/citizens advice|advicenow|legal aid|lawworks|pro bono|civil legal advice|check if you are eligible/.test(hay)) {
    return true
  }

  if (matter === 'housing') {
    return /hous|tenant|landlord|rent|deposit|shelter|homeless|evict|possession|flatmate|roommate|notice to quit|section 21|hlpas|leasehold/.test(
      hay,
    )
  }
  if (session.taxonomySlug === 'parking_pcn') {
    return /parking|pcn|tribunal|consumer|motoring|rta|citizens advice/.test(hay)
  }
  if (matter === 'consumer') {
    return /consumer|car|vehicle|refund|trader|ombudsman|resolver|which\b|faulty|goods|parking|pcn|tribunal/.test(
      hay,
    )
  }
  if (matter === 'crime') {
    return /crime|criminal|motoring|police|magistrates|disqualif|driving|duty solicitor/.test(hay)
  }
  if (matter === 'employment') {
    return /employ|work|tribunal|acas|dismissal|wages/.test(hay)
  }
  if (matter === 'immigration') {
    return /immig|asylum|visa|refugee|home office|oisc|settled|ilr/.test(hay)
  }
  if (matter === 'debt') {
    return /debt|money advice|insolvency|bankrupt|bailiff/.test(hay)
  }
  if (matter === 'family') {
    return /family|divorce|child|custody|domestic/.test(hay)
  }

  return /citizens advice|advicenow|legal aid|lawworks|pro bono|civil legal advice/.test(hay)
}

function mergeFreeHelp(
  agentFree: Row[],
  signRows: Row[],
  legalAid: Row[],
  probono: Row[],
  session: SessionState,
  limit = 8,
): Row[] {
  const out: Row[] = []
  const seen = new Set<string>()

  const push = (row: Row) => {
    if (!isRelevantFreeHelp(row, session)) return
    const key = normKey(row.title, row.url)
    if (seen.has(key)) return
    const titleKey = row.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if ([...seen].some((k) => k.startsWith(`${titleKey}|`) || k === titleKey)) return
    seen.add(key)
    out.push(row)
  }

  for (const row of agentFree) push(row)

  const matterSectionsPreferred =
    session.matterType === 'housing'
      ? ['home and housing']
      : session.matterType === 'consumer'
        ? ['consumer rights']
        : session.matterType === 'immigration'
          ? ['immigration and citizenship']
          : []

  const rankedSign = [...signRows].sort((a, b) => {
    const aPref = matterSectionsPreferred.some((s) => (a.section || '').toLowerCase().includes(s))
      ? 1
      : 0
    const bPref = matterSectionsPreferred.some((s) => (b.section || '').toLowerCase().includes(s))
      ? 1
      : 0
    if (aPref !== bPref) return bPref - aPref
    return (b.score || 0) - (a.score || 0)
  })
  for (const row of rankedSign) push(row)
  for (const row of legalAid) push(row)
  for (const row of probono) push(row)

  return out.slice(0, limit)
}

export function ServicesView({ session, frames = [], helpMatch = null, onBack, onOpenSraFirm }: Props) {
  const [pack, setPack] = useState<HelpPack | null>(null)
  const [loading, setLoading] = useState(true)

  const placeLine = [
    session.taxonomySlug === 'parking_pcn' ? 'Parking / PCN' : matterLabel(session.matterType),
    session.locationHint
      ? session.locationHint
      : session.jurisdiction === 'EnglandWales'
        ? 'England & Wales'
        : session.jurisdiction === 'Unknown'
          ? ''
          : session.jurisdiction === 'NorthernIreland'
            ? 'Northern Ireland'
            : session.jurisdiction,
    session.goal ? `Goal: ${session.goal}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const next = await buildHelpPack(session, frames)
      if (cancelled) return
      setPack(next)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [session, frames])

  const phase2Rows: Row[] =
    pack?.phase2Wiki.map((s) => ({
      id: s.id,
      type: `Wiki · ${s.topic}`,
      title: s.title,
      blurb: s.description,
      url: s.sourceUrl,
    })) ?? []

  const v1Rows: Row[] =
    pack?.v1Wiki.map((s) => ({
      id: s.id,
      type: `Knowledge · ${s.topic}`,
      title: s.title,
      blurb: s.description,
      url: s.sourceUrl,
    })) ?? []

  const signRows: Row[] =
    pack?.signposts.map((s) => ({
      id: s.id,
      type: `Free · ${s.section}`,
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      phone: s.phone,
      section: s.section,
      score: s.score,
    })) ?? []

  const aidRows: Row[] =
    pack?.legalAid.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      phone: s.phone,
    })) ?? []

  const sraRows: Row[] =
    pack?.sraFirms.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      blurb: s.blurb,
      phone: s.phone,
      sraId: s.sraId,
    })) ?? []

  const proRows: Row[] =
    pack?.probono.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      phone: s.phone,
      score: s.score,
    })) ?? []

  const dirRows: Row[] =
    pack?.directories.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      blurb: s.blurb,
      url: s.url,
    })) ?? []

  const agentFreeRows: Row[] =
    helpMatch?.freeHelp.map((s) => ({
      id: s.id,
      type: 'Free help',
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      phone: s.phone,
    })) ?? []

  const agentDirRows: Row[] =
    helpMatch?.directories.map((s) => ({
      id: s.id,
      type: 'Directory',
      title: s.title,
      blurb: s.blurb,
      url: s.url,
    })) ?? []

  const agentSolRows: Row[] =
    helpMatch?.solicitors.map((s) => ({
      id: s.id,
      type: 'Solicitor signpost',
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      phone: s.phone,
      sraId: s.sraId,
    })) ?? []

  const freeRows = mergeFreeHelp(agentFreeRows, signRows, aidRows, proRows, session, 8)

  const guidanceRows: Row[] = [...phase2Rows, ...v1Rows]

  const helpMatchHasLiveSra = (helpMatch?.solicitors || []).some(
    (s) => s.type === 'sra-live' || s.id?.startsWith('sra-live:'),
  )

  const showSraSolicitors = agentSolRows.length > 0 || (!helpMatchHasLiveSra && sraRows.length > 0)

  const empty =
    !loading &&
    !freeRows.length &&
    !sraRows.length &&
    !dirRows.length &&
    !agentDirRows.length &&
    !agentSolRows.length &&
    !guidanceRows.length

  const freeLead =
    session.taxonomySlug === 'parking_pcn'
      ? 'PCN free help first — Citizens Advice and the parking tribunal, then Motoring / RTA solicitors.'
      : session.matterType === 'housing'
        ? 'Housing-focused free advice first — Shelter, tenant clinics, and Citizens Advice before paid solicitors.'
        : session.matterType === 'consumer'
          ? 'Consumer free help first — Citizens Advice and ADR schemes before paid solicitors.'
          : session.matterType === 'crime'
            ? 'Free guidance first — then directories for regulated criminal / motoring solicitors.'
            : 'Start with free advice services matched to your issue, then directories and solicitors.'

  return (
    <div className="services">
      <header className="services__header">
        <button type="button" className="services__back" onClick={onBack}>
          ← Back to timeline
        </button>
        <h1 className="services__title">Matching help</h1>
        <p className="services__sub">{placeLine}</p>
        {helpMatch && (
          <p className="services__hint">
            Free help first ({freeRows.length} shown), then directories ({helpMatch.directories.length})
            and SRA solicitors ({helpMatch.solicitors.length})
            {helpMatch.sra?.reachable
              ? ` · live register ${helpMatch.sra.total?.toLocaleString() ?? '—'} orgs`
              : helpMatch.sra?.configured
                ? ' · live SRA unreachable (start Podman Postgres on :5433)'
                : ' · live SRA offline (set DATABASE_URL)'}
            .
          </p>
        )}
        {pack && !loading && pack.sraFirms.length > 0 && !session.locationHint && (
          <p className="services__hint">
            Add your town or postcode on the timeline to rank nearby solicitors first.
            {session.taxonomySlug === 'parking_pcn' &&
              ' Firms shown list Motoring / RTA or Consumer parking work — confirm they take council PCN appeals.'}
            {session.matterType === 'consumer' &&
              session.taxonomySlug !== 'parking_pcn' &&
              ' Firms shown list Consumer work on the SRA register — confirm they take used-car / faulty-goods cases.'}
            {session.matterType === 'housing' &&
              ' Firms shown list housing / property work — confirm they take tenant or landlord disputes.'}
          </p>
        )}
        {pack && (
          <p className="services__trial">
            {pack.meta.sra?.reachable
              ? `Live SRA register: ${pack.meta.sra.total?.toLocaleString() ?? '—'} organisations. `
              : pack.meta.sra?.configured
                ? 'Live SRA register temporarily unreachable — start Podman Postgres (`./podman-postgres-data.sh` on :5433) then refresh. '
                : 'SRA live search offline (set DATABASE_URL to 127.0.0.1:5433). '}
            Not legal advice — verify live pages and regulation yourself.
          </p>
        )}
      </header>

      <div className="services__layout">
        <ShareWithSolicitorPanel session={session} frames={frames} />

        <div className="services__matches">
          {loading ? (
            <p className="services__blurb">Loading matching guidance…</p>
          ) : empty ? (
            <p className="services__blurb">No matches yet — try adding a place or more detail.</p>
          ) : (
            <>
              <Section
                title="Free help first"
                lead={freeLead}
                rows={freeRows}
                variant="free"
                onOpenSraFirm={onOpenSraFirm}
              />
              {agentDirRows.length > 0 && (
                <Section
                  title="Find a regulated solicitor"
                  rows={agentDirRows}
                  onOpenSraFirm={onOpenSraFirm}
                />
              )}
              {agentSolRows.length > 0 && (
                <Section
                  title="SRA solicitors (after free help)"
                  rows={agentSolRows}
                  onOpenSraFirm={onOpenSraFirm}
                />
              )}
              {!helpMatchHasLiveSra && (
                <Section
                  title="SRA-regulated solicitors (live register)"
                  rows={sraRows}
                  onOpenSraFirm={onOpenSraFirm}
                />
              )}
              {!agentDirRows.length && <Section title="Official directories" rows={dirRows} />}
              <Section title="Guidance (UK legal wiki)" rows={guidanceRows} />
              {showSraSolicitors ? (
                <SraAttribution className="services__sra-attribution" />
              ) : null}
            </>
          )}
        </div>
      </div>

      <p className="services__note">
        Signposts only — verify regulation and suitability yourself. Not a recommendation ranking. Not legal
        advice. Free help is filtered to your matter type; SRA firm cards come from the live register when
        available.
      </p>
    </div>
  )
}
