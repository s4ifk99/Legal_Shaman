import type { SessionState } from './types'
import type { SolicitorBriefV0 } from './briefSchema'
import { SYSTEM_DISCLAIMER, resolveRiskRouting } from './compliance'
import type { FrameFit } from './coherence'
import type { LegalFrame } from './frames'
import type { LawyerReviewRecord, SolicitorBriefWithReview } from './lawyerLoop'
import { matterLabel } from './services'
import { missingSlots } from './slots'
import { tidySentence } from './timelineExtract'

export type { SolicitorBriefV0 } from './briefSchema'
export { validateSolicitorBriefShape, SOLICITOR_BRIEF_REQUIRED_KEYS } from './briefSchema'
export type { SolicitorBriefWithReview } from './lawyerLoop'

export interface LawyerBrief {
  ready: boolean
  title: string
  createdAt: string
  situationSummary: string
  instructionsForLawyer: string
  desiredOutcome: string
  timeline: { order: number; when: string; event: string }[]
  parties: string[]
  documents: string[]
  jurisdiction: string
  matterType: string
  softFlags: string[]
  openGaps: string[]
  legalFrames?: { id: string; label: string; why: string }[]
  disclaimer: string
  /** Phase 0 handoff extras (immigration trial) */
  riskRouting: 'standard' | 'urgent_human' | 'emergency_services_info'
  immediateDanger: boolean
  urgentHelpCopy?: string
  readyForSolicitor: boolean
  openQuestions: string[]
  issues: { id: string; rank: 'primary' | 'alternative'; label: string; why: string }[]
}

function jurisdictionLabel(session: SessionState): string {
  const map = {
    EnglandWales: 'England & Wales',
    Scotland: 'Scotland',
    NorthernIreland: 'Northern Ireland',
    Unknown: 'Unknown',
  } as const
  const base = map[session.jurisdiction]
  return session.locationHint ? `${base} (${session.locationHint})` : base
}

function sessionTextBlob(session: SessionState): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => e.label),
    ...session.softFlags,
  ].join(' ')
}

function guessDatePrecision(dateApprox: string | undefined): 'day' | 'month' | 'year' | 'unknown' {
  if (!dateApprox) return 'unknown'
  if (/\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2}/.test(dateApprox)) return 'day'
  if (/\w+\s+\d{4}|\d{4}-\d{2}/.test(dateApprox)) return 'month'
  if (/\d{4}/.test(dateApprox)) return 'year'
  return 'unknown'
}

function newBriefId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `brief-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Core slots filled + enough progress. Jurisdiction required before solicitor-ready. */
export function isBriefReady(session: SessionState, progress: number): boolean {
  if (session.rawInputs.length === 0) return false
  if (progress >= 85) return true
  return missingSlots(session).length === 0
}

export function isReadyForSolicitor(session: SessionState, progress: number): boolean {
  if (!isBriefReady(session, progress)) return false
  if (session.jurisdiction === 'Unknown') return false
  if (!session.goal.trim()) return false
  if (session.events.length === 0 && !session.whatHappened.trim()) return false
  return true
}

function buildSituationSummary(session: SessionState): string {
  const situationParts: string[] = [
    'This client was recommended by LegalShaman.com (signposting only — not a referral for paid work, and not legal advice).',
  ]
  if (session.matterType !== 'unknown') {
    situationParts.push(`This appears to concern ${matterLabel(session.matterType).toLowerCase()}.`)
  }
  if (session.whatHappened) {
    situationParts.push(`What happened (client narrative): ${session.whatHappened}`)
  } else if (session.events.length) {
    situationParts.push(`Key events reported: ${session.events.map((e) => e.label).join('; ')}.`)
  } else if (session.rawInputs[0]) {
    situationParts.push(`Client’s opening account: “${session.rawInputs[0]}”.`)
  }
  if (session.howCaused) {
    situationParts.push(`How the client says it was caused: ${session.howCaused}`)
  }
  if (session.parties.length) {
    situationParts.push(`People / bodies mentioned: ${session.parties.map((p) => p.label).join(', ')}.`)
  }
  if (session.softFlags.includes('character_concern_raised')) {
    situationParts.push(
      'Client raised a character / suitability concern (client-stated — not a finding).',
    )
  }
  if (session.safetyRisk) {
    situationParts.push('Safety / urgency flag was raised during intake — check urgently.')
  }
  return situationParts.join(' ') || 'Insufficient detail captured yet.'
}

function buildIssues(frames: LegalFrame[]): LawyerBrief['issues'] {
  return frames.map((f, i) => ({
    id: f.id,
    rank: i === 0 ? 'primary' : 'alternative',
    label: f.label,
    why: f.why,
  }))
}

export function buildLawyerBrief(
  session: SessionState,
  progress: number,
  frames: LegalFrame[] = [],
): LawyerBrief {
  const ready = isBriefReady(session, progress)
  const readyForSolicitor = isReadyForSolicitor(session, progress)
  const timeline = session.events.map((e, i) => ({
    order: i + 1,
    when: e.dateApprox || 'Date not given',
    event: e.rawSpan ? tidySentence(e.rawSpan, 220) : e.label,
  }))

  const gaps = missingSlots(session).map((s) => s.label)
  const risk = resolveRiskRouting({
    safetyRisk: session.safetyRisk,
    mode: session.mode,
    textBlob: sessionTextBlob(session),
  })

  const instructions: string[] = [
    'This client was recommended by LegalShaman.com. Please treat this as a triage handoff note generated from client intake — not advice and not a complete file.',
    'Orient on the timeline and desired outcome first; confirm facts with the client.',
  ]
  if (gaps.length) {
    instructions.push(`Still incomplete or unclear: ${gaps.join(', ')}.`)
  } else {
    instructions.push('Core intake slots appear filled enough for an initial solicitor review.')
  }
  if (session.jurisdiction === 'Unknown') {
    instructions.push('Jurisdiction still Unknown — confirm England & Wales / Scotland / NI before advising.')
  }
  if (session.documents.length) {
    instructions.push(
      `Ask the client for: ${session.documents.join(', ')} (mentioned or implied in intake).`,
    )
  } else {
    instructions.push('Ask what documents exist (letters, contracts, messages, medical notes).')
  }
  if (frames.length) {
    instructions.push(
      `Possible competing frames to consider (not ranked advice): ${frames.map((f) => f.label).join('; ')}.`,
    )
  }
  instructions.push(
    `Jurisdiction indicated: ${jurisdictionLabel(session)}. Verify before advising on nation-specific rules.`,
  )
  if (risk.routing !== 'standard') {
    instructions.push('Risk / safety routing is elevated — prioritise urgent human review.')
  }

  const openQuestions = [
    ...gaps.map((g) => `Still needed: ${g}`),
    ...(session.jurisdiction === 'Unknown' ? ['Is the matter in England & Wales, Scotland, or Northern Ireland?'] : []),
  ]

  return {
    ready,
    title: 'Notes for your Lawyer',
    createdAt: new Date().toISOString(),
    situationSummary: buildSituationSummary(session),
    instructionsForLawyer: instructions.join(' '),
    desiredOutcome: session.goal || 'Not yet stated by the client.',
    timeline,
    parties: session.parties.map((p) => (p.role ? `${p.label} (${p.role})` : p.label)),
    documents: session.documents,
    jurisdiction: jurisdictionLabel(session),
    matterType: matterLabel(session.matterType),
    softFlags: session.softFlags,
    openGaps: gaps,
    legalFrames: frames.map((f) => ({ id: f.id, label: f.label, why: f.why })),
    disclaimer: SYSTEM_DISCLAIMER,
    riskRouting: risk.routing,
    immediateDanger: risk.immediate_danger,
    urgentHelpCopy: risk.urgentHelpCopy,
    readyForSolicitor,
    openQuestions,
    issues: buildIssues(frames),
  }
}

/**
 * Canonical Phase 0 JSON handoff (C1 solicitor brief v0).
 * Immigration trial: other matter types still emit, but fixtures grade immigration only.
 */
export function buildSolicitorBrief(
  session: SessionState,
  progress: number,
  frames: LegalFrame[] = [],
  opts?: {
    briefId?: string
    signposts?: SolicitorBriefV0['signposts_shown_to_client']
    clarifiers?: SolicitorBriefV0['clarifiers_asked']
    corpusVersion?: string
    /** Phase 2 wiki citations keyed by frame id */
    sourcesByFrame?: Record<
      string,
      { title: string; url_or_id: string; jurisdiction: string; snippet: string }[]
    >
    /** Phase 3 local fit per frame — unmet_constraints come from here, not intake gaps */
    frameFits?: FrameFit[]
    conflictsDetected?: SolicitorBriefV0['conflicts_detected']
  },
): SolicitorBriefV0 {
  const display = buildLawyerBrief(session, progress, frames)
  const fitById = new Map((opts?.frameFits ?? []).map((f) => [f.frameId, f]))
  const risk = resolveRiskRouting({
    safetyRisk: session.safetyRisk,
    mode: session.mode,
    textBlob: sessionTextBlob(session),
  })

  const urgencyFlags: string[] = []
  if (session.safetyRisk) urgencyFlags.push('safety_risk_flagged')
  if (session.mode === 'urgent') urgencyFlags.push('mode_urgent')
  if (risk.routing !== 'standard') urgencyFlags.push(risk.routing)

  const issues: SolicitorBriefV0['issues'] = frames.map((f, i) => {
    const fit = fitById.get(f.id)
    const unmet =
      fit?.unmetConstraints ??
      f.unmetConstraints ??
      []
    const why = fit?.supports?.length ? [f.why, ...fit.supports.slice(0, 2)] : [f.why]
    return {
      id: f.id,
      rank: i === 0 ? ('primary' as const) : ('alternative' as const),
      frame_label: f.id,
      plain_label: f.label,
      why_this_frame: why,
      unmet_constraints: unmet,
      urgency_flags: urgencyFlags,
      limitation_flags: [],
      candidate_sources: opts?.sourcesByFrame?.[f.id] ?? [],
    }
  })

  if (issues.length === 0 && session.matterType === 'immigration') {
    issues.push({
      id: 'imm-general',
      rank: 'primary',
      frame_label: 'imm-general',
      plain_label: 'UK immigration status / application',
      why_this_frame: ['Matter typed as immigration; frames will refine with more timeline detail.'],
      unmet_constraints: [],
      urgency_flags: urgencyFlags,
      limitation_flags: [],
      candidate_sources: opts?.sourcesByFrame?.['imm-general'] ?? [],
    })
  }

  const constraintQuestions = (opts?.frameFits ?? []).flatMap((f) => f.openQuestions)
  const openQuestions = Array.from(
    new Set([...display.openQuestions, ...constraintQuestions]),
  )

  return {
    schema_version: 'c1.brief.v0',
    trial_domain: 'immigration',
    brief_id: opts?.briefId ?? newBriefId(),
    created_at: display.createdAt,
    model_versions: {
      extractor: 'coherence-intake/heuristics',
      ranker: 'coherence-intake/local-fit-v1',
      corpus: opts?.corpusVersion ?? 'immigrationWiki.json',
    },
    jurisdiction: session.jurisdiction,
    jurisdiction_label: display.jurisdiction,
    client: {
      preferred_name: '',
      contact_permission: false,
      vulnerability_flags: session.softFlags.filter((f) => /vulnerab|safety|detain/i.test(f)),
      communication_needs: [],
    },
    client_goal: {
      stated: session.goal || 'Not yet stated by the client.',
      success_looks_like: session.goal || '',
      source: session.goal ? 'client' : 'inferred_unconfirmed',
    },
    timeline: session.events.map((e, i) => ({
      order: i + 1,
      date_approx: e.dateApprox || '',
      date_precision: guessDatePrecision(e.dateApprox),
      event: e.rawSpan ? tidySentence(e.rawSpan, 220) : e.label,
      actors: [],
      source: 'client' as const,
      client_confirmed: true,
    })),
    matter_summary_plain: display.situationSummary,
    matter_type: session.matterType,
    parties: session.parties.map((p) => ({
      name_or_label: p.label,
      role: p.role || '',
      notes: '',
    })),
    documents_mentioned: session.documents.map((label) => ({
      label,
      status: 'said_to_exist' as const,
    })),
    issues,
    open_questions: openQuestions,
    clarifiers_asked: opts?.clarifiers ?? [],
    signposts_shown_to_client: opts?.signposts ?? [],
    conflicts_detected:
      opts?.conflictsDetected ??
      [],
    risk_and_safety: {
      immediate_danger: risk.immediate_danger,
      routing: risk.routing,
    },
    handoff: {
      ready_for_solicitor: display.readyForSolicitor,
      consent_to_share: false,
      attachments: [],
    },
    system_boundaries: {
      disclaimer: SYSTEM_DISCLAIMER,
      ...(risk.urgentHelpCopy ? { urgent_help: risk.urgentHelpCopy } : {}),
    },
  }
}

export function briefToPlainText(brief: LawyerBrief): string {
  const lines: string[] = [
    brief.title.toUpperCase(),
    'Source: Client was recommended by LegalShaman.com',
    `Created: ${new Date(brief.createdAt).toLocaleString('en-GB')}`,
    brief.ready ? 'Status: Ready for lawyer review' : 'Status: DRAFT — still gathering information',
    brief.readyForSolicitor
      ? 'Handoff: Ready for solicitor (jurisdiction + goal + timeline/narrative present)'
      : 'Handoff: Not yet solicitor-ready',
    `Risk routing: ${brief.riskRouting}`,
    '',
    '— SITUATION SUMMARY —',
    brief.situationSummary,
    '',
    '— DESIRED OUTCOME —',
    brief.desiredOutcome,
    '',
    '— INSTRUCTIONS FOR THE LAWYER —',
    brief.instructionsForLawyer,
    '',
    '— TIMELINE —',
  ]

  if (brief.timeline.length === 0) {
    lines.push('(No timeline events captured yet.)')
  } else {
    for (const row of brief.timeline) {
      lines.push(`${row.order}. [${row.when}] ${row.event}`)
    }
  }

  lines.push('', '— DETAILS —')
  lines.push(`Matter type: ${brief.matterType}`)
  lines.push(`Jurisdiction: ${brief.jurisdiction}`)
  if (brief.issues.length) {
    lines.push('', '— ISSUES (RANKED) —')
    for (const issue of brief.issues) {
      lines.push(`• [${issue.rank}] ${issue.label}: ${issue.why}`)
    }
  } else if (brief.legalFrames?.length) {
    lines.push('', '— POSSIBLE LEGAL FRAMES —')
    for (const f of brief.legalFrames) lines.push(`• ${f.label}: ${f.why}`)
  }
  if (brief.parties.length) lines.push(`Parties: ${brief.parties.join('; ')}`)
  if (brief.documents.length) lines.push(`Documents mentioned: ${brief.documents.join('; ')}`)
  if (brief.openQuestions.length) {
    lines.push('', '— OPEN QUESTIONS —')
    for (const q of brief.openQuestions) lines.push(`• ${q}`)
  } else if (brief.openGaps.length) {
    lines.push(`Open gaps: ${brief.openGaps.join('; ')}`)
  }
  if (brief.urgentHelpCopy) {
    lines.push('', '— URGENT HELP —', brief.urgentHelpCopy)
  }
  lines.push('', brief.disclaimer)
  return lines.join('\n')
}

export function briefToJsonDownload(
  brief: SolicitorBriefV0 | SolicitorBriefWithReview,
  review?: LawyerReviewRecord,
): string {
  const payload: SolicitorBriefWithReview = review
    ? { ...brief, lawyer_review: review }
    : brief
  return JSON.stringify(payload, null, 2)
}
