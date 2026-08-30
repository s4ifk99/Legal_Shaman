import { useEffect, useMemo, useState } from 'react'
import type { SessionState } from '@/lib/coherence/types'
import { proposeLegalFrames, type LegalFrame } from '@/lib/coherence/frames'
import {
  buildHelpPack,
  matterLabel,
  matchingSessionForHelp,
  type HelpPack,
} from '@/lib/coherence/services'
import type { HelpMatchResult } from '@/lib/coherence/masterAgent'
import { buildLawyerBrief, briefToPlainText, placeForSummary } from '@/lib/coherence/brief'
import { computeProgress } from '@/lib/coherence/slots'
import { isParkingStoryText } from '@/lib/coherence/signposting'
import {
  isFamilyBelongingsDisputeText,
  isParkingSpecialistService,
  isPropertyDamageClaimText,
} from '@/lib/coherence/matchFreeServices'
import { SraAttribution } from '@/components/sra-attribution'
import { PageNavigation, type PageNavigationProps } from './PageNavigation'
import './ServicesView.css'

interface Props {
  session: SessionState
  frames?: LegalFrame[]
  helpMatch?: HelpMatchResult | null
  onBack: () => void
  onOpenSraFirm?: (sraId: string) => void
  pageNavigation?: PageNavigationProps
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

function jurisdictionLabel(session: SessionState): string {
  switch (session.jurisdiction) {
    case 'EnglandWales':
      return 'England & Wales'
    case 'Scotland':
      return 'Scotland'
    case 'NorthernIreland':
      return 'Northern Ireland'
    case 'Unknown':
      return 'Not yet confirmed'
    default:
      return session.jurisdiction || 'Not yet confirmed'
  }
}

function legalAreaLabel(session: SessionState): string {
  if (session.taxonomySlug === 'parking_pcn') return 'Parking / PCN'
  if (session.ukTaxonomyL1 || session.ukTaxonomyL2) {
    return [session.ukTaxonomyL1, session.ukTaxonomyL2].filter(Boolean).join(' · ')
  }
  return matterLabel(session.matterType)
}

function disputeTypeLabel(session: SessionState): string {
  const labels: Record<string, string> = {
    consumer_services: 'Consumer services / contractor workmanship dispute',
    consumer_small_claims: 'Consumer small claim / money recovery',
    consumer_vehicle_repair: 'Used vehicle / repair dispute',
    parking_pcn: 'Parking charge / PCN dispute',
    neighbour_dispute: 'Neighbour access / property dispute',
    employment: 'Employment / workplace dispute',
    housing: 'Housing / tenancy dispute',
    conveyancing: 'Conveyancing / property purchase dispute',
    family: 'Family / relationship dispute',
    debt: 'Debt / enforcement dispute',
    immigration: 'Immigration / visa matter',
  }
  if (session.taxonomySlug && labels[session.taxonomySlug]) return labels[session.taxonomySlug]
  if (session.topicId && session.topicId !== 'general') {
    return session.topicId.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  }
  return session.matterType === 'unknown' ? 'General legal matter — still being classified' : matterLabel(session.matterType)
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
  variant?: 'free' | 'read'
}) {
  if (!rows.length) return null
  return (
    <section
      className={[
        'services__section',
        variant === 'free' ? 'services__section--free' : '',
        variant === 'read' ? 'services__section--read' : '',
      ]
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

function CaseContext({
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

  const summaryLines = brief.situationSummary
    .split('\n')
    .map((line) => line.replace(/^•\s*/, '').trim())
    .filter((line) => line && !/^Recommended by LegalShaman/i.test(line))

  const area = legalAreaLabel(session)
  const jurisdiction = jurisdictionLabel(session)
  const location = placeForSummary(session) || (session.locationHint || '').trim()

  return (
    <div className="services__context">
      <section className="services__context-block" aria-labelledby="services-timeline">
        <h2 id="services-timeline" className="services__section-title">
          Timeline
        </h2>
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
      </section>

      <section className="services__context-block" aria-labelledby="services-summary">
        <h2 id="services-summary" className="services__section-title">
          Situation summary
        </h2>
        {summaryLines.length === 0 ? (
          <p className="services__share-empty">No summary yet.</p>
        ) : (
          <ul className="services__share-bullets" aria-label="Situation summary">
            {summaryLines.map((line, i) => (
              <li key={`sum-${i}`}>{line}</li>
            ))}
          </ul>
        )}
        {brief.desiredOutcome ? (
          <p className="services__share-outcome">
            <span className="services__meta-label">Goal</span> {brief.desiredOutcome}
          </p>
        ) : null}
      </section>

      <section className="services__context-block" aria-labelledby="services-area">
        <h2 id="services-area" className="services__section-title">
          Legal area
        </h2>
        <p className="services__meta-value">{area}</p>
        {session.matterType !== 'unknown' && session.taxonomySlug !== 'parking_pcn' ? (
          <p className="services__meta-sub">{matterLabel(session.matterType)}</p>
        ) : null}
      </section>

      <section className="services__context-block" aria-labelledby="services-dispute-type">
        <h2 id="services-dispute-type" className="services__section-title">
          Dispute type
        </h2>
        <p className="services__meta-value">{disputeTypeLabel(session)}</p>
        <p className="services__meta-sub">Used to route the most relevant free help, directories and solicitors.</p>
      </section>

      <section className="services__context-block" aria-labelledby="services-jurisdiction">
        <h2 id="services-jurisdiction" className="services__section-title">
          Jurisdiction
        </h2>
        <dl className="services__meta-list">
          <div>
            <dt>Nation / system</dt>
            <dd>{jurisdiction}</dd>
          </div>
          {location ? (
            <div>
              <dt>Location</dt>
              <dd>{location}</dd>
            </div>
          ) : (
            <div>
              <dt>Location</dt>
              <dd className="services__meta-muted">Not specified — add a town or postcode to rank nearby solicitors.</dd>
            </div>
          )}
        </dl>
      </section>

      <div className="services__share-actions">
        <button type="button" className="services__share-copy" onClick={() => void copyShare()}>
          {copied ? 'Copied' : 'Copy summary for solicitor'}
        </button>
        <p className="services__share-copy-hint">
          Includes a “Recommended by LegalShaman.com” note for when you contact a firm.
        </p>
      </div>
    </div>
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
  const parkingStory =
    session.taxonomySlug === 'parking_pcn' || isParkingStoryText(story)
  const propertyDamage = isPropertyDamageClaimText(story)
  const familyBelongings = isFamilyBelongingsDisputeText(story)

  if (/therap|counsell|intercultural|wellbeing|well-being|psycholog/.test(hay) && !/trauma|mental|abuse/.test(story)) {
    return false
  }

  // Parking appeal routes never appear on non-parking searches
  if (!parkingStory && isParkingSpecialistService(hay)) {
    return false
  }

  if (parkingStory) {
    if (
      /age uk|free representation unit|\bfru\b|employment|social security|universal credit|\bavma\b|clinical|medical accident|nhs complaint/.test(
        hay,
      )
    ) {
      return false
    }
    return /parking|pcn|popla|\bias\b|independent appeals|tribunal|adjudicator|adviceline|consumer helpline|resolver|advicenow|legal aid|pro bono|citizens advice|penalty charge|motoring/.test(
      hay,
    )
  }

  // Core free advice hubs — always OK when not parking-gated above
  if (/citizens advice|advicenow|legal aid|lawworks|pro bono|civil legal advice|check if you are eligible/.test(hay)) {
    return true
  }

  // Family + damaged belongings / sue → consumer / small-claims free help, not DA packs
  if (familyBelongings || (matter === 'family' && propertyDamage)) {
    if (
      /domestic (?:abuse|violence)|rape crisis|refuge\b|\bncdv\b|national centre for domestic|domestic violence assist|rights of women|ourfamilywizard|family mediation|dad'?s house|only dads|family rights group|age uk|creditor/.test(
        hay,
      )
    ) {
      if (!/\b(domestic (?:abuse|violence)|rape|refuge|molestation)\b/.test(story)) return false
    }
    return /consumer|small claim|money claim|citizens advice|advicenow|legal aid|civil legal advice|goods|damag|court|family|child|parent/.test(
      hay,
    )
  }

  if (matter === 'housing') {
    return /hous|tenant|landlord|rent|deposit|shelter|homeless|evict|possession|flatmate|roommate|notice to quit|section 21|hlpas|leasehold/.test(
      hay,
    )
  }
  if (matter === 'consumer' || propertyDamage) {
    return /consumer|refund|trader|ombudsman|resolver|which\b|faulty|goods|small claim|money claim|citizens advice|advicenow/.test(
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
    return /family|divorce|child|custody|domestic|parent|contact/.test(hay)
  }

  return /citizens advice|advicenow|legal aid|lawworks|pro bono|civil legal advice/.test(hay)
}

function mergeFreeHelp(
  dialableServices: Row[],
  authorityOfficial: Row[],
  agentFree: Row[],
  signRows: Row[],
  legalAid: Row[],
  probono: Row[],
  session: SessionState,
  limit = 12,
): Row[] {
  const out: Row[] = []
  const seen = new Set<string>()
  const story = [...session.rawInputs, session.whatHappened, session.goal].join(' ')
  const parkingStory =
    session.taxonomySlug === 'parking_pcn' ||
    /\b(car\s*park|parking|pcn|popla|parking (?:fine|ticket|charge)|private parking)\b/i.test(story)

  const pushAllowlisted = (row: Row) => {
    const phoneKey = (row.phone || '').replace(/\D/g, '')
    if (phoneKey) {
      if (seen.has(`phone:${phoneKey}`)) return
      seen.add(`phone:${phoneKey}`)
    }
    const key = normKey(row.title, row.url)
    if (seen.has(key)) return
    const titleKey = row.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if ([...seen].some((k) => k.startsWith(`${titleKey}|`) || k === titleKey)) return
    seen.add(key)
    out.push(row)
  }

  const push = (row: Row) => {
    if (!isRelevantFreeHelp(row, session)) return
    pushAllowlisted(row)
  }

  for (const row of dialableServices) push(row)
  for (const row of authorityOfficial) push(row)
  for (const row of agentFree) push(row)

  const matterSectionsPreferred = parkingStory
    ? ['driving and parking', 'consumer rights']
    : isFamilyBelongingsDisputeText(story) || isPropertyDamageClaimText(story)
      ? ['consumer rights', 'courts and disputes']
      : session.matterType === 'housing'
        ? ['home and housing']
        : session.matterType === 'consumer'
          ? ['consumer rights']
          : session.matterType === 'family'
            ? ['family', 'relationships']
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

export function ServicesView({
  session,
  frames = [],
  helpMatch = null,
  onBack,
  onOpenSraFirm,
  pageNavigation,
}: Props) {
  const [pack, setPack] = useState<HelpPack | null>(null)
  const [loading, setLoading] = useState(true)
  const helpSession = useMemo(() => matchingSessionForHelp(session), [session])
  const helpFrames = useMemo(
    () => (helpSession === session ? frames : proposeLegalFrames(helpSession, 5)),
    [frames, helpSession, session],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const next = await buildHelpPack(helpSession, helpFrames)
      if (cancelled) return
      setPack(next)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [helpFrames, helpSession])

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

  const freeServiceRows: Row[] =
    pack?.freeServices.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      phone: s.phone,
      score: s.score,
    })) ?? []

  const authorityOfficialRows: Row[] =
    pack?.authorityOfficial.map((s) => ({
      id: s.id,
      type:
        s.tier === 'primary'
          ? 'Official · primary'
          : s.tier === 'secondary'
            ? 'Official · guidance'
            : 'Trusted resource',
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      score: s.score,
    })) ?? []

  const authorityFirmRows: Row[] =
    pack?.authorityFirms.map((s) => ({
      id: s.id,
      type: s.firm ? `Firm · ${s.firm}` : 'Law firm commentary',
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      score: s.score,
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

  const arambResourceRows: Row[] =
    (helpSession.penumbraResearch?.bundle?.freeResources || [])
      .filter((resource) => resource.matterType === helpSession.matterType || resource.matterType === 'unknown')
      .map((resource) => ({
        id: `aramb-resource:${resource.id}`,
        type: `The Shaman lead · ${resource.resourceType} · pending review`,
        title: resource.title,
        blurb: `${resource.description} Source-linked to ${resource.sourceIds.join(', ')}. Verify suitability before relying on it.`,
        url: resource.url,
        phone: resource.phone,
      }))

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

  const freeRows = mergeFreeHelp(
    freeServiceRows,
    authorityOfficialRows,
    agentFreeRows,
    signRows,
    aidRows,
    proRows,
    session,
    12,
  )

  const guidanceRows: Row[] = [...phase2Rows, ...v1Rows]
  const parkingStory =
    session.taxonomySlug === 'parking_pcn' ||
    isParkingStoryText(
      [...session.rawInputs, session.whatHappened, session.goal].join(' '),
    )
  const readingRows: Row[] = [...guidanceRows, ...authorityFirmRows].filter((row) => {
    if (!parkingStory) return true
    const hay = `${row.title} ${row.blurb} ${row.type}`.toLowerCase()
    return /parking|pcn|popla|motoring|ticket|penalty charge|citizens advice/.test(hay)
  })

  const helpMatchHasLiveSra = (helpMatch?.solicitors || []).some(
    (s) => (s.type === 'sra-live' || s.id?.startsWith('sra-live:')) && (s.title || '').trim(),
  )

  // Prefer live SRA register hits from HelpPack. Agent solicitors only win when they
  // actually include live SRA rows — never hide pack firms behind an empty agent list.
  const solicitorRows: Row[] =
    helpMatchHasLiveSra && agentSolRows.length > 0
      ? agentSolRows
      : sraRows.length > 0
        ? sraRows
        : agentSolRows

  const directoryRows: Row[] = agentDirRows.length > 0 ? agentDirRows : dirRows

  const showSraSolicitors = solicitorRows.some((r) => r.sraId) || sraRows.length > 0

  const empty =
    !loading &&
    !freeRows.length &&
    !solicitorRows.length &&
    !directoryRows.length &&
    !readingRows.length

  return (
    <div className="services">
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
      <header className="services__header">
        <button type="button" className="services__back" onClick={onBack}>
          ← Back to timeline
        </button>
        <h1 className="services__title">Matching help</h1>
        <p className="services__sub">
          Your situation, who to contact (free first), then relevant reading.
        </p>
      </header>

      <CaseContext session={helpSession} frames={helpFrames} />

      <div className="services__matches">
        <h2 className="services__band-title">People and services to contact</h2>
        <p className="services__band-lead">Free help first, then regulated solicitors you can approach.</p>

        {loading ? (
          <p className="services__blurb">Loading matching guidance…</p>
        ) : empty ? (
          <p className="services__blurb">No matches yet — try adding a place or more detail.</p>
        ) : (
          <>
            {arambResourceRows.length > 0 && (
              <Section
                title="Additional resources found by The Shaman"
                lead="Open-web resources found after the curated Legal Shaman review. These leads are not yet verified or approved."
                rows={arambResourceRows}
                variant="free"
                onOpenSraFirm={onOpenSraFirm}
              />
            )}
            <Section
              title="Free services"
              lead="Charities and helplines you can call first, then official guidance pages."
              rows={freeRows}
              variant="free"
              onOpenSraFirm={onOpenSraFirm}
            />
            <Section
              title="Solicitors"
              lead={
                session.locationHint
                  ? `Regulated firms for ${session.locationHint} and your legal area — confirm they take your matter.`
                  : 'Regulated firms from the SRA register — add a town or postcode to rank nearby first.'
              }
              rows={solicitorRows}
              onOpenSraFirm={onOpenSraFirm}
            />
            {directoryRows.length > 0 && (
              <Section
                title="Find more solicitors"
                lead="Official directories if you want a wider search."
                rows={directoryRows}
                onOpenSraFirm={onOpenSraFirm}
              />
            )}
            {showSraSolicitors ? (
              <SraAttribution className="services__sra-attribution" />
            ) : null}

            <Section
              title="Things to read"
              lead="Relevant wiki and indexed commentary for your situation."
              rows={readingRows}
              variant="read"
              onOpenSraFirm={onOpenSraFirm}
            />
          </>
        )}
      </div>

      {pack && (
        <p className="services__trial">
          {pack.meta.sra?.reachable
            ? `Live SRA register: ${pack.meta.sra.total?.toLocaleString() ?? '—'} organisations. `
            : pack.meta.sra?.configured
              ? 'Live SRA register temporarily unreachable — start Podman Postgres on :5433 then refresh. '
              : 'SRA live search offline (set DATABASE_URL). '}
          Not legal advice — verify live pages and regulation yourself.
        </p>
      )}

      <p className="services__note">
        Signposts only — verify regulation and suitability yourself. Not a recommendation ranking. Not legal
        advice.
      </p>
      {helpSession.matterType !== session.matterType ? (
        <p className="services__note">
          Matching area adjusted to {matterLabel(helpSession.matterType)} after reviewing the case evidence.
        </p>
      ) : null}
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
    </div>
  )
}
