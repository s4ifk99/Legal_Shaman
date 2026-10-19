import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionState, UkNation } from '@/lib/coherence/types'
import {
  availabilityAt,
  coverageForService,
  coverageLabel,
  NATION_LABEL,
  resolveSessionLocation,
  type Alternative,
  type UserLocation,
} from '@/lib/coherence/serviceCoverage'
import { proposeLegalFrames, type LegalFrame } from '@/lib/coherence/frames'
import {
  buildHelpPack,
  matterLabel,
  matchingSessionForHelp,
  type HelpPack,
} from '@/lib/coherence/services'
import { freezeIssueGraph } from '@/lib/coherence/freezeIssueGraph'
import { classifyHelpDoorKind, rankPeopleFirst } from '@/lib/coherence/peopleFirst'
import {
  SEARCH_MAG_DEFAULT,
  SEARCH_MAG_MAX,
  SEARCH_MAG_META,
  SEARCH_MAG_MIN,
  filterFreeHelpByMag,
  magBlurbMax,
  magShowRawUrl,
  magShowScores,
  parseSearchMagLevel,
  showDirectoriesAtMag,
  showRawSourcesAtMag,
  showSolicitorsAtMag,
  showThirdEyeHelpAtMag,
  type SearchMagLevel,
} from '@/lib/coherence/searchMagnification'
import { visibleThirdEyeHelp } from '@/lib/coherence/thirdEyeMatchingHelp'
import { toWorkspaceProviders, type WorkspaceSource } from '@/lib/coherence/providerRecords'
import {
  curateMatchingProviders,
  disputeLens,
  matchesDispute,
  parkedOffMatchingHelp,
  withSingleCitizensAdviceLast,
} from '@/lib/coherence/matchingRelevance'
import { housingDeadlineApplies, urgencyForNecessity } from '@/lib/necessity/categories'
import { ResultsWorkspace, type WorkspaceSection } from './ResultsWorkspace'
import type { HelpMatchResult } from '@/lib/coherence/masterAgent'
import { buildLawyerBrief, briefToPlainText, placeForSummary } from '@/lib/coherence/brief'
import { computeProgress } from '@/lib/coherence/slots'
import { isParkingStoryText } from '@/lib/coherence/signposting'
import { freeHelpAdmissibleOnGeometry } from '@/lib/matter/graphAdmissibility'
import {
  isFamilyBelongingsDisputeText,
  isInsuranceComplaintStoryText,
  isParkingSpecialistService,
  isPropertyDamageClaimText,
} from '@/lib/coherence/matchFreeServices'
import { SraAttribution } from '@/components/sra-attribution'
import { sraLaneAlert, sraRegisterFootnote } from '@/lib/coherence/sraRegisterFootnote'
import { captureProductEvent } from '@/components/analytics/posthog-provider'
import { PageNavigation, type PageNavigationProps } from './PageNavigation'
import { LocationField } from './LocationField'
import './ServicesView.css'

interface Props {
  session: SessionState
  frames?: LegalFrame[]
  helpMatch?: HelpMatchResult | null
  onBack: () => void
  onOpenSraFirm?: (sraId: string) => void
  onLocationChange?: (input: string, nation: UkNation | null) => void
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
  rawSource?: boolean
  /** Coverage tag shown when the user hasn't given a location, e.g. "England only". */
  coverage?: string
  city?: string
}

type MissingRow = { id: string; title: string; reason: string; alternative?: Alternative }

/**
 * Keep rows that serve the user's location; record the rest in `missing`.
 * Rows past `missingCutoff` are dropped silently (they would not have been shown anyway).
 */
function partitionByLocation(
  rows: Row[],
  loc: UserLocation | null,
  missing: Map<string, MissingRow>,
  missingCutoff = Infinity,
): Row[] {
  const out: Row[] = []
  rows.forEach((row, index) => {
    const coverage = coverageForService({
      id: row.id,
      title: row.title,
      url: row.url,
      type: row.type,
      sraId: row.sraId,
    })
    const availability = availabilityAt(coverage, loc)
    if (availability.available) {
      out.push(loc ? row : { ...row, coverage: coverageLabel(coverage) ?? undefined })
      return
    }
    if (index >= missingCutoff) return
    const key = row.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!missing.has(key)) {
      missing.set(key, {
        id: row.id,
        title: row.title,
        reason: availability.reason,
        alternative: availability.alternative,
      })
    }
  })
  return out
}

function MissingSection({ place, rows }: { place: string; rows: MissingRow[] }) {
  if (!rows.length) return null
  return (
    <section
      id="services-missing"
      className="services__section services__section--missing"
      aria-labelledby="services-missing-title"
    >
      <h2 id="services-missing-title" className="services__section-title">
        Not available in {place} ({rows.length})
      </h2>
      <p className="services__section-lead">
        These matched your situation but don&apos;t cover where you are, so we&apos;ve left them out
        of the lists above.
      </p>
      <ul className="services__missing-list">
        {rows.map((r) => (
          <li key={r.id} className="services__missing-item">
            <p className="services__missing-name">{r.title}</p>
            <p className="services__missing-reason">{r.reason}</p>
            {r.alternative ? (
              <a
                className="services__link"
                href={r.alternative.url}
                target="_blank"
                rel="noreferrer"
              >
                Try instead: {r.alternative.title} →
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
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
  if (t.includes('raw search')) return 'Raw search'
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

function Item({
  s,
  onOpenSraFirm,
  mag,
}: {
  s: Row
  onOpenSraFirm?: (sraId: string) => void
  mag: SearchMagLevel
}) {
  const phone = (s.phone || '').trim()
  const tel = phone ? telHref(phone) : ''
  const relevance = relevanceLabel(s.score, s.relevance || (s.sraId ? s.blurb.split(' — ')[0] : ''))
  const blurb = s.sraId && mag < 5 ? '' : compactBlurb(s.blurb, magBlurbMax(mag))
  const showScore = magShowScores(mag) && s.score != null && s.score > 0

  return (
    <li className={s.rawSource ? 'services__item services__item--raw' : 'services__item'}>
      <div className="services__item-top">
        <span className="services__type">{shortTypeLabel(s.type)}</span>
        {s.coverage ? <span className="services__coverage">{s.coverage}</span> : null}
        {showScore ? (
          <span className="services__relevance-score" title="Match strength">
            Relevance {Math.min(99, Math.round(s.score!))}
          </span>
        ) : s.score != null && s.score > 0 && mag >= 3 ? (
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
      ) : s.sraId && mag >= 3 ? (
        <p className="services__phone services__phone--missing">Phone not listed on SRA register</p>
      ) : null}
      {relevance && mag >= 3 ? <p className="services__relevance">{relevance}</p> : null}
      {(!relevance || mag >= 4) && blurb ? <p className="services__blurb">{blurb}</p> : null}
      {magShowRawUrl(mag) && s.url ? (
        <p className="services__raw-url">
          <span className="services__phone-label">Source</span> {s.url}
        </p>
      ) : null}
      <div className="services__actions">
        {s.sraId && onOpenSraFirm && mag >= 3 ? (
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
  mag,
}: {
  title: string
  lead?: string
  rows: Row[]
  onOpenSraFirm?: (sraId: string) => void
  variant?: 'free' | 'read'
  mag: SearchMagLevel
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
          <Item key={s.id} s={s} onOpenSraFirm={onOpenSraFirm} mag={mag} />
        ))}
      </ul>
    </section>
  )
}

const MAG_STORAGE_KEY = 'ls-matching-help-search-mag'

function SearchMagnificationSlider({
  value,
  onChange,
}: {
  value: SearchMagLevel
  onChange: (level: SearchMagLevel) => void
}) {
  const meta = SEARCH_MAG_META[value]
  return (
    <div className="services__mag">
      <div className="services__mag-head">
        <label className="services__mag-label" htmlFor="search-magnification">
          Search magnification
        </label>
        <p className="services__mag-value">
          {value} · {meta.name}
        </p>
      </div>
      <input
        id="search-magnification"
        className="services__mag-range"
        type="range"
        min={SEARCH_MAG_MIN}
        max={SEARCH_MAG_MAX}
        step={1}
        value={value}
        aria-valuemin={SEARCH_MAG_MIN}
        aria-valuemax={SEARCH_MAG_MAX}
        aria-valuenow={value}
        aria-valuetext={`${value}, ${meta.name}`}
        onChange={(e) => onChange(parseSearchMagLevel(e.target.value))}
      />
      <ol className="services__mag-ticks">
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <li key={n}>
            <button
              type="button"
              className={n === value ? 'services__mag-tick services__mag-tick--on' : 'services__mag-tick'}
              onClick={() => onChange(n)}
            >
              {n} {SEARCH_MAG_META[n].name}
            </button>
          </li>
        ))}
      </ol>
      <p className="services__mag-hint">{meta.hint}</p>
    </div>
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

  const timelineRows: { order: number; when: string; event: string }[] =
    brief.timeline.length > 0
      ? brief.timeline.map((row) => ({ order: row.order, when: row.when, event: row.event }))
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

  if (parkedOffMatchingHelp(row.title, `${row.blurb || ''} ${row.url || ''}`)) return false
  if (!freeHelpAdmissibleOnGeometry(row.title, `${row.blurb || ''} ${row.url || ''}`, story)) {
    return false
  }

  if (isInsuranceComplaintStoryText(story)) {
    if (/legal aid agency|civil legal advice|check if you are eligible for legal aid/i.test(hay)) {
      return false
    }
    if (/consumer helpline|which\?|resolver/i.test(hay) && !/financial ombudsman/i.test(hay)) {
      return false
    }
    return (
      /financial ombudsman|moneyhelper|money advice/i.test(hay) ||
      (/citizens advice/i.test(hay) && !/consumer helpline|consumer service/i.test(hay))
    )
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

  const dispute = {
    necessitySlug: session.necessitySlug,
    taxonomySlug: session.taxonomySlug,
    matterType: session.matterType,
    text: story,
  }
  if (!matchesDispute(row, dispute)) return false
  if (matter === 'housing' || disputeLens(dispute) === 'neighbour' || disputeLens(dispute) === 'tenancy') {
    return true
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
  for (const row of rankedSign) {
    if (
      isInsuranceComplaintStoryText(story) &&
      /legal aid|which\?|resolver|consumer helpline/i.test(`${row.title} ${row.blurb}`) &&
      !/financial ombudsman/i.test(row.title)
    ) {
      continue
    }
    push(row)
  }
  if (!isInsuranceComplaintStoryText(story)) {
    for (const row of legalAid) push(row)
  }
  for (const row of probono) push(row)

  const ordered = withSingleCitizensAdviceLast(out)
  const fallback = ordered.at(-1)
  const adviceLast = Boolean(fallback && /citizens advice/i.test(fallback.title))
  const rest = adviceLast ? ordered.slice(0, -1) : ordered
  const room = adviceLast ? limit - 1 : limit
  return [...rest.slice(0, room), ...(adviceLast && fallback ? [fallback] : [])]
}

export function ServicesView({
  session,
  frames = [],
  helpMatch = null,
  onBack,
  onOpenSraFirm,
  onLocationChange,
  pageNavigation,
}: Props) {
  const userLocation = useMemo(() => resolveSessionLocation(session), [session])
  const [pack, setPack] = useState<HelpPack | null>(null)
  const [cachedHelp, setCachedHelp] = useState<
    NonNullable<SessionState['penumbraResearch']>['bundle']['freeResources']
  >([])
  const [loading, setLoading] = useState(true)
  const [mag, setMag] = useState<SearchMagLevel>(SEARCH_MAG_DEFAULT)

  useEffect(() => {
    try {
      setMag(parseSearchMagLevel(sessionStorage.getItem(MAG_STORAGE_KEY)))
    } catch {
      setMag(SEARCH_MAG_DEFAULT)
    }
  }, [])

  function onMagChange(level: SearchMagLevel) {
    setMag(level)
    try {
      sessionStorage.setItem(MAG_STORAGE_KEY, String(level))
    } catch {
      /* ignore */
    }
    captureProductEvent('matching_help_search_mag', { level, name: SEARCH_MAG_META[level].name })
  }
  const helpSession = useMemo(
    () => matchingSessionForHelp(freezeIssueGraph(session)),
    [session],
  )
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

  useEffect(() => {
    let cancelled = false
    const matterType = helpSession.matterType || 'unknown'
    void (async () => {
      try {
        const res = await fetch(
          `/api/coherence/help-candidates?matterType=${encodeURIComponent(matterType)}`,
        )
        if (!res.ok) return
        const data = (await res.json()) as { resources?: typeof cachedHelp }
        if (cancelled || !Array.isArray(data.resources)) return
        setCachedHelp(data.resources)
      } catch {
        /* Matching Help still works from indexed services + this session's Third Eye bundle */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [helpSession.matterType])

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
      city: s.city,
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

  const thirdEyeStory = [...helpSession.rawInputs, helpSession.whatHappened, helpSession.goal].join(' ')
  const thirdEyeHelp = visibleThirdEyeHelp({
    sessionResources: helpSession.penumbraResearch?.bundle?.freeResources || [],
    cachedResources: cachedHelp,
    matterType: helpSession.matterType,
    story: thirdEyeStory,
  })
  const thirdEyeFreeRows: Row[] = thirdEyeHelp.free.map((resource) => ({
    id: `third-eye-free:${resource.id}`,
    type: 'Third Eye · free help',
    title: resource.title,
    blurb: `${resource.description} Verify this organisation before you rely on it.`,
    url: resource.url,
    phone: resource.phone,
  }))
  const thirdEyePaidRows: Row[] = thirdEyeHelp.paid.map((resource) => ({
    id: `third-eye-paid:${resource.id}`,
    type: 'Third Eye · directory',
    title: resource.title,
    blurb: `${resource.description} Official directory lead from Third Eye — not a named firm recommendation.`,
    url: resource.url,
    phone: resource.phone,
  }))
  const missing = new Map<string, MissingRow>()
  const visibleThirdEyeFree = showThirdEyeHelpAtMag(mag)
    ? partitionByLocation(thirdEyeFreeRows, userLocation, missing)
    : []
  const visibleThirdEyePaid = showThirdEyeHelpAtMag(mag)
    ? partitionByLocation(thirdEyePaidRows, userLocation, missing)
    : []

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

  const freeRowsUnsorted = partitionByLocation(
    mergeFreeHelp(
      freeServiceRows,
      authorityOfficialRows,
      agentFreeRows,
      signRows,
      aidRows,
      proRows,
      session,
      40,
    ),
    userLocation,
    missing,
    12,
  ).slice(0, 12)
  const peopleOrder = new Map(
    rankPeopleFirst(
      freeRowsUnsorted.map((r) => ({
        id: r.id,
        title: r.title,
        kind: classifyHelpDoorKind(r.title, r.type, 'match_free_help'),
        blurb: r.blurb,
        url: r.url,
        phone: r.phone,
        tool: 'match_free_help' as const,
      })),
    ).map((d, i) => [d.id, i]),
  )
  const freeRows = filterFreeHelpByMag(
    [...freeRowsUnsorted].sort(
      (a, b) => (peopleOrder.get(a.id) ?? 99) - (peopleOrder.get(b.id) ?? 99),
    ),
    mag,
  )

  const helpMatchHasLiveSra = (helpMatch?.solicitors || []).some(
    (s) => (s.type === 'sra-live' || s.id?.startsWith('sra-live:')) && (s.title || '').trim(),
  )

  // Prefer live SRA register hits from HelpPack. Agent solicitors only win when they
  // actually include live SRA rows — never hide pack firms behind an empty agent list.
  const solicitorRows: Row[] = (
    helpMatchHasLiveSra && agentSolRows.length > 0
      ? agentSolRows
      : sraRows.length > 0
        ? sraRows
        : agentSolRows
  ).slice().sort(
    (a, b) =>
      (b.phone ? 1 : 0) - (a.phone ? 1 : 0) ||
      (b.score || 0) - (a.score || 0) ||
      a.title.localeCompare(b.title),
  )

  const directoryRows: Row[] = agentDirRows.length > 0 ? agentDirRows : dirRows

  const solicitorRowsAtMag = showSolicitorsAtMag(mag) ? solicitorRows : []
  const visibleSolicitorRows = partitionByLocation(solicitorRowsAtMag, userLocation, missing)
  const solicitorsHiddenByLocation = solicitorRowsAtMag.length > 0 && visibleSolicitorRows.length === 0
  const visibleDirectoryRows = showDirectoriesAtMag(mag)
    ? partitionByLocation(directoryRows, userLocation, missing)
    : []
  const missingRows = [...missing.values()]
  const localHelpByUrl = new Map<string, { title: string; url: string; replaces: string[] }>()
  for (const m of missingRows) {
    if (!m.alternative) continue
    const entry = localHelpByUrl.get(m.alternative.url) ?? { ...m.alternative, replaces: [] }
    entry.replaces.push(m.title)
    localHelpByUrl.set(m.alternative.url, entry)
  }
  const localHelpRows: Row[] = [...localHelpByUrl.values()].map((alt) => ({
    id: `local-alt:${alt.url}`,
    type: 'Free help',
    title: alt.title,
    blurb: `Covers ${userLocation?.nation ? NATION_LABEL[userLocation.nation] : 'your area'} — in place of ${alt.replaces.join(', ')}.`,
    url: alt.url,
  }))
  const rawSourceRows: Row[] = showRawSourcesAtMag(mag)
    ? [
        ...(pack?.phase2Wiki || []).map((s) => ({
          id: `raw-wiki-${s.id}`,
          type: 'Raw search · wiki',
          title: s.title,
          blurb: s.description,
          url: s.sourceUrl,
          score: s.score,
          rawSource: true,
        })),
        ...(pack?.v1Wiki || []).map((s) => ({
          id: `raw-v1-${s.id}`,
          type: 'Raw search · knowledge',
          title: s.title,
          blurb: s.description,
          url: s.sourceUrl,
          score: s.score,
          rawSource: true,
        })),
        ...(helpMatch?.ranked || []).map((s, i) => ({
          id: s.id || `raw-ranked-${i}`,
          type: `Raw search · ${s.type || 'hit'}`,
          title: s.title,
          blurb: s.blurb,
          url: s.url,
          phone: s.phone,
          sraId: s.sraId,
          rawSource: true,
        })),
      ]
    : []

  const showSraSolicitors = visibleSolicitorRows.some((r) => r.sraId) || (showSolicitorsAtMag(mag) && sraRows.length > 0)
  const sraAlert =
    !loading && showSolicitorsAtMag(mag) && !solicitorsHiddenByLocation
      ? sraLaneAlert(pack?.meta.sra, visibleSolicitorRows.length)
      : null

  const locationKey = userLocation ? `${userLocation.nation}:${userLocation.label}` : ''
  const lastLocationEvent = useRef('')
  useEffect(() => {
    if (loading || !userLocation) return
    const key = `${locationKey}:${missingRows.length}`
    if (lastLocationEvent.current === key) return
    lastLocationEvent.current = key
    captureProductEvent('matching_help_location_filtered', {
      nation: userLocation.nation ?? 'unknown',
      london: userLocation.london,
      hidden_count: missingRows.length,
    })
  }, [loading, locationKey, missingRows.length, userLocation])

  function handleLocationChange(input: string, nation: UkNation | null) {
    captureProductEvent('matching_help_location_set', {
      nation: nation ?? 'cleared',
      has_postcode: /\d/.test(input),
    })
    onLocationChange?.(input, nation)
  }

  useEffect(() => {
    if (loading || !pack || solicitorRows.length > 0) return
    captureProductEvent('matching_help_sra_empty', {
      matter_type: helpSession.matterType,
      taxonomy_slug: helpSession.taxonomySlug || '',
      empty_reason: pack.meta.sra?.emptyReason || 'unknown',
      sra_reachable: Boolean(pack.meta.sra?.reachable),
    })
  }, [loading, pack, solicitorRows.length, helpSession.matterType, helpSession.taxonomySlug])

  function asSource(rows: Row[], sourceLabel: string, loc: UserLocation | null): WorkspaceSource[] {
    return rows.map((row) => {
      const coverage = coverageForService({
        id: row.id,
        title: row.title,
        url: row.url,
        type: row.type,
        sraId: row.sraId,
      })
      const label = row.coverage || coverageLabel(coverage) || undefined
      const availability = loc ? availabilityAt(coverage, loc) : { available: true as const }
      let coversPlace = availability.available
      let unavailableReason = availability.available ? undefined : availability.reason
      if (coversPlace && row.sraId && loc) {
        const town = loc.label.split(',')[0]?.trim().toLowerCase()
        const city = (row.city || '').trim().toLowerCase()
        const near = Boolean(town && city && (city.includes(town) || town.includes(city)))
        coversPlace = near
        unavailableReason = near
          ? undefined
          : row.city
            ? `Office listed in ${row.city}, not ${loc.label}`
            : `No office town on the SRA row for ${loc.label}`
      }
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        blurb: row.blurb,
        url: row.url,
        phone: row.phone,
        sraId: row.sraId,
        coverage: label,
        city: row.city,
        sourceLabel,
        coversPlace,
        unavailableReason,
      }
    })
  }

  const disputeContext = {
    necessitySlug: session.necessitySlug,
    taxonomySlug: helpSession.taxonomySlug,
    matterType: helpSession.matterType,
    text: thirdEyeStory,
  }
  const workspaceProviders = curateMatchingProviders(toWorkspaceProviders([
    ...asSource(localHelpRows, 'Indexed free help', userLocation),
    ...asSource(freeRows, 'Indexed free help', userLocation),
    ...asSource(thirdEyeFreeRows, 'Third Eye', userLocation),
    ...asSource(solicitorRows, 'SRA register', userLocation),
    ...asSource(thirdEyePaidRows, 'Third Eye', userLocation),
    ...asSource(directoryRows, 'Official directory', userLocation),
  ]), disputeContext)
  const wikiRows: Row[] = [
    ...(pack?.phase2Wiki || []).map((s) => ({
      id: `wiki-${s.id}`,
      type: 'Wiki guide',
      title: s.title,
      blurb: s.description,
      url: s.sourceUrl,
    })),
    ...(pack?.v1Wiki || []).map((s) => ({
      id: `wiki-v1-${s.id}`,
      type: 'Wiki guide',
      title: s.title,
      blurb: s.description,
      url: s.sourceUrl,
    })),
  ]
  const wikiProviders = toWorkspaceProviders(asSource(wikiRows, 'Wiki guide', userLocation)).filter((provider) =>
    matchesDispute(
      { title: provider.name, blurb: provider.blurb, type: 'Wiki guide' },
      disputeContext,
    ),
  )
  const solicitorProviders = workspaceProviders.filter(
    (provider) => provider.sraId || provider.positioning === 'sra_firm' || provider.positioning === 'directory',
  )
  const solicitorKeys = new Set(solicitorProviders.map((provider) => provider.key))
  const freeProviders = workspaceProviders.filter((provider) => !solicitorKeys.has(provider.key))
  const resourceSections: WorkspaceSection[] = [
    { id: 'free-services', title: 'Free services', providers: freeProviders },
    { id: 'solicitors', title: 'Solicitors', providers: solicitorProviders },
    { id: 'wiki-guides', title: 'Wiki guides', providers: wikiProviders },
  ]

  const urgency = housingDeadlineApplies({
    necessitySlug: session.necessitySlug,
    matterType: helpSession.matterType,
    taxonomySlug: helpSession.taxonomySlug,
    text: thirdEyeStory,
  })
    ? urgencyForNecessity('property-housing')
    : isParkingStoryText(thirdEyeStory) || session.necessitySlug === 'pcn'
      ? urgencyForNecessity('pcn')
      : null

  const empty =
    !loading &&
    !localHelpRows.length &&
    !freeRows.length &&
    !visibleSolicitorRows.length &&
    !visibleDirectoryRows.length &&
    !rawSourceRows.length &&
    !visibleThirdEyeFree.length &&
    !visibleThirdEyePaid.length

  return (
    <div className="services">
      {pageNavigation ? <PageNavigation {...pageNavigation} /> : null}
      <header className="services__header">
        <button type="button" className="services__back" onClick={onBack}>
          ← Back to timeline
        </button>
        <h1 className="services__title">Matching help</h1>
        <nav className="services__jumps" aria-label="Resource groups">
          <a href="#free-services">
            Free services
            <span>{freeProviders.length}</span>
          </a>
          <a href="#solicitors">
            Solicitors
            <span>{solicitorProviders.length}</span>
          </a>
          <a href="#wiki-guides">
            Wiki guides
            <span>{wikiProviders.length}</span>
          </a>
        </nav>
        <p className="services__sub">Not legal advice.</p>
        {urgency ? (
          <div className="services__urgency" role="status">
            <p className="services__urgency-title">{urgency.title}</p>
            <p>{urgency.body}</p>
            <p className="services__urgency-links">
              {urgency.links.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ))}
            </p>
          </div>
        ) : null}
      </header>

      <div className="services__layout services__layout--results">
        <div className="services__main">
          <div className="services__matches">
            {loading ? (
              <p className="services__blurb">Loading matching guidance…</p>
            ) : (
              <ResultsWorkspace
                providers={[...freeProviders, ...solicitorProviders, ...wikiProviders]}
                sections={resourceSections}
                place={userLocation}
                onPlaceChange={onLocationChange ? handleLocationChange : undefined}
              />
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
