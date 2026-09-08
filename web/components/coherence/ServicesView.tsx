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
import { freeHelpAdmissibleOnGeometry } from '@/lib/matter/graphAdmissibility'
import {
  isFamilyBelongingsDisputeText,
  isParkingSpecialistService,
  isPropertyDamageClaimText,
} from '@/lib/coherence/matchFreeServices'
import { SraAttribution } from '@/components/sra-attribution'
import { sraRegisterFootnote } from '@/lib/coherence/sraRegisterFootnote'
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
  relevance?: string
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

/** One-line blurb — strip scraped headings / nav noise. */
function compactBlurb(text: string, max = 140): string {
  const cleaned = text
    .replace(/#{1,6}\s*/g, '')
    .replace(/\bSee advice for\b[^.!?\n]*/gi, '')
    .replace(/\bHelp us improve[^.!?\n]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  if (cleaned.length <= max) return cleaned
  const cut = cleaned.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

function relevanceLabel(score?: number, fallback?: string): string {
  if (fallback?.trim()) return compactBlurb(fallback, 110)
  if (score == null || Number.isNaN(score)) return ''
  if (score >= 28) return 'Strong match for this dispute type'
  if (score >= 18) return 'Good match — confirm they take your matter'
  if (score >= 12) return 'Possible match from the SRA register'
  return 'Listed on the SRA register'
}

function shortTypeLabel(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('sra')) return 'SRA firm'
  if (t.includes('third eye') && t.includes('free')) return 'Free help'
  if (t.includes('third eye')) return 'Directory'
  if (t.includes('free')) return 'Free help'
  if (t.includes('official')) return 'Official'
  if (t.includes('pro bono')) return 'Pro bono'
  if (t.includes('legal aid')) return 'Legal aid'
  if (t.includes('directory')) return 'Directory'
  return compactBlurb(type, 28)
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
    defamation_media: 'Defamation / media / reputation',
  }
  if (session.taxonomySlug && labels[session.taxonomySlug]) return labels[session.taxonomySlug]
  if (session.taxonomySlug === 'defamation_media') return 'Defamation / media / reputation'
  if (session.topicId && session.topicId !== 'general') {
    return session.topicId.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  }
  return session.matterType === 'unknown' ? 'General legal matter — still being classified' : matterLabel(session.matterType)
}

function Item({ s, onOpenSraFirm }: { s: Row; onOpenSraFirm?: (sraId: string) => void }) {
  const phone = (s.phone || '').trim()
  const tel = phone ? telHref(phone) : ''
  const relevance = relevanceLabel(s.score, s.relevance || (s.sraId ? s.blurb.split(' — ')[0] : ''))
  const blurb = s.sraId ? '' : compactBlurb(s.blurb, 120)

  return (
    <li className="services__item">
      <div className="services__item-top">
        <span className="services__type">{shortTypeLabel(s.type)}</span>
        {s.score != null && s.score > 0 ? (
          <span className="services__relevance-score" title="Match strength from the SRA register">
            Relevance {Math.min(99, Math.round(s.score))}
          </span>
        ) : null}
      </div>
      <h3 className="services__name">{s.title}</h3>
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
      {relevance ? <p className="services__relevance">{relevance}</p> : null}
      {!relevance && blurb ? <p className="services__blurb">{blurb}</p> : null}
      <div className="services__actions">
        {s.sraId && onOpenSraFirm ? (
          <button
            type="button"
            className="services__link services__link--button"
            onClick={() => onOpenSraFirm(s.sraId!)}
          >
            Firm profile →
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

function StickyCaseRail({
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

  const area = legalAreaLabel(session)
  const jurisdiction = jurisdictionLabel(session)
  const location = placeForSummary(session) || (session.locationHint || '').trim()
  const dispute = disputeTypeLabel(session)

  return (
    <aside className="services__rail" aria-label="Case routing">
      <div className="services__rail-block">
        <p className="services__meta-label">Legal area</p>
        <p className="services__meta-value">{area}</p>
      </div>
      <div className="services__rail-block">
        <p className="services__meta-label">Dispute type</p>
        <p className="services__meta-value">{dispute}</p>
      </div>
      <div className="services__rail-block">
        <p className="services__meta-label">Jurisdiction</p>
        <p className="services__meta-value services__meta-value--compact">{jurisdiction}</p>
        <p className="services__meta-sub">
          {location || 'Add a town or postcode to rank nearby solicitors.'}
        </p>
      </div>
      <div className="services__share-actions">
        <button type="button" className="services__share-copy" onClick={() => void copyShare()}>
          {copied ? 'Copied' : 'Copy summary for solicitor'}
        </button>
        <p className="services__share-copy-hint">
          Includes a “Recommended by LegalShaman.com” note.
        </p>
      </div>
    </aside>
  )
}

function CaseContext({
  session,
  frames,
}: {
  session: SessionState
  frames: LegalFrame[]
}) {
  const progress = useMemo(() => computeProgress(session), [session])
  const brief = useMemo(
    () => buildLawyerBrief(session, progress, frames),
    [session, progress, frames],
  )

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

  if (!freeHelpAdmissibleOnGeometry(row.title, `${row.blurb || ''} ${row.url || ''}`, story)) {
    return false
  }

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
      url: s.url,
      sraId: s.sraId,
      score: s.score,
      relevance: s.blurb.split(' — ')[0],
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
      type: s.sraId ? 'SRA-regulated firm' : 'Solicitor signpost',
      title: s.title,
      blurb: s.blurb,
      url: s.url,
      phone: s.phone,
      sraId: s.sraId,
      relevance: compactBlurb(s.blurb, 110),
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

  const empty = !loading && !freeRows.length && !solicitorRows.length && !directoryRows.length

  return (
    <div className="services">
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
      <header className="services__header">
        <button type="button" className="services__back" onClick={onBack}>
          ← Back to timeline
        </button>
        <h1 className="services__title">Matching help</h1>
        <p className="services__sub">
          Firm names and numbers first — free help, then SRA-regulated solicitors.
        </p>
      </header>

      <div className="services__layout">
        <StickyCaseRail session={helpSession} frames={helpFrames} />
        <div className="services__main">
          <CaseContext session={helpSession} frames={helpFrames} />

          <div className="services__matches">
            <h2 className="services__band-title">Who to contact</h2>
            <p className="services__band-lead">
              Curated contacts for this dispute — free help, then SRA-regulated firms.
            </p>

            {loading ? (
              <p className="services__blurb">Loading matching guidance…</p>
            ) : empty ? (
              <p className="services__blurb">No matches yet — try adding a place or more detail.</p>
            ) : (
              <>
                <Section
                  title="Free help"
                  lead="Charities and helplines matched to this dispute type."
                  rows={freeRows}
                  variant="free"
                  onOpenSraFirm={onOpenSraFirm}
                />
                <Section
                  title="SRA-regulated solicitors"
                  lead={
                    solicitorRows.length
                      ? session.locationHint
                        ? `Firms for ${session.locationHint} and your dispute type — confirm they take your matter.`
                        : 'Firms from the SRA register for this dispute type — add a town or postcode to rank nearby.'
                      : pack?.meta.sra && !pack.meta.sra.reachable
                        ? 'SRA directory is temporarily unavailable — use the official search links below, or try again shortly.'
                        : 'No named firms matched yet — add a town or postcode, or use the official directories below.'
                  }
                  rows={solicitorRows}
                  onOpenSraFirm={onOpenSraFirm}
                />
                {!loading && !solicitorRows.length ? (
                  <p className="services__empty-solicitors" role="status">
                    SRA firm contacts will appear here when the register returns a match for this dispute
                    type.
                  </p>
                ) : null}
                {directoryRows.length > 0 && (
                  <Section
                    title="Official directories"
                    lead="Search the registers yourself if you want a wider list."
                    rows={directoryRows}
                    onOpenSraFirm={onOpenSraFirm}
                  />
                )}
                {showSraSolicitors ? (
                  <SraAttribution className="services__sra-attribution" />
                ) : null}
              </>
            )}
          </div>

          {pack && (
            <p className="services__trial">
              {sraRegisterFootnote(pack.meta.sra)}
              Not legal advice — verify live pages and regulation yourself.
            </p>
          )}

          <p className="services__note">
            Signposts only — verify regulation and suitability yourself. Not a recommendation ranking. Not
            legal advice.
          </p>
          {helpSession.matterType !== session.matterType ? (
            <p className="services__note">
              Matching area adjusted to {matterLabel(helpSession.matterType)} after reviewing the case
              evidence.
            </p>
          ) : null}
        </div>
      </div>
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
    </div>
  )
}
