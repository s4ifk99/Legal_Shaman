/**
 * CAQI-inspired search context profile + Shao-inspired lay intent taxonomy.
 * Used to enrich retrieval text and choose AB success metrics.
 */

import type { Jurisdiction, MatterType, Mode, SessionState } from './types'

/** Adapted from Shao et al. legal intent taxonomy for lay UK A2J search. */
export type SearchIntent =
  | 'particular_resource'
  | 'characterization'
  | 'remedy_outcome'
  | 'procedure'
  | 'interest_browse'

export type UserRoleHint =
  | 'tenant'
  | 'landlord'
  | 'employee'
  | 'employer'
  | 'consumer'
  | 'immigrant_applicant'
  | 'family_member'
  | 'unknown'

export interface SearchContextProfile {
  jurisdiction: Jurisdiction
  locationHint: string
  matterType: MatterType
  mode: Mode
  role: UserRoleHint
  urgency: 'normal' | 'elevated' | 'urgent'
  intent: SearchIntent
  /** Short tokens injected into retrieval corpora */
  tokens: string[]
  /** Which online metric should gate AB success for this intent */
  abPrimaryMetric:
    | 'precision_at_k'
    | 'frame_confirm_rate'
    | 'task_completion'
    | 'guidance_step_engagement'
    | 'session_depth'
}

const INTENT_METRIC: Record<SearchIntent, SearchContextProfile['abPrimaryMetric']> = {
  particular_resource: 'precision_at_k',
  characterization: 'frame_confirm_rate',
  remedy_outcome: 'task_completion',
  procedure: 'guidance_step_engagement',
  interest_browse: 'session_depth',
}

function blob(session: SessionState): string {
  return [
    session.confirmedSearchQuery,
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => e.label),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Clear first-person employer / business voice. */
export function isEmployerVoice(t: string): boolean {
  return (
    /\bi\s+am\s+(the\s+|an\s+)?employer\b/.test(t) ||
    /\bi'?m\s+(the\s+|an\s+)?employer\b/.test(t) ||
    /\bas\s+(an?\s+|the\s+)?employer\b/.test(t) ||
    /\bmy\s+(staff|employees?|workers?)\b/.test(t) ||
    /\bi\s+employ\b/.test(t) ||
    /\bi\s+(own|run)\s+(a\s+|the\s+)?(small\s+)?(business|company|firm|shop)\b/.test(t) ||
    /\bcan\s+i\s+(sack|fire|dismiss|make\s+redundant)\b/.test(t) ||
    /\bhow\s+do\s+i\s+(dismiss|sack|fire|make\s+.*redundant)\b/.test(t)
  )
}

/** First-person worker / patient voice (harmed or constrained by the job). */
export function isEmployeeVoice(t: string): boolean {
  if (isEmployerVoice(t)) return false

  const patterns = [
    /\bmy\s+employer\b/,
    /\bmy\s+(boss|manager|hr|line\s+manager)\b/,
    /\bi\s+was\s+(sacked|fired|dismissed|made\s+redundant)\b/,
    /\bi'?ve\s+been\s+(sacked|fired|dismissed|made\s+redundant)\b/,
    /\bi\s+have\s+been\s+(sacked|fired|dismissed|made\s+redundant)\b/,
    /\b(sacked|fired|dismissed)\s+me\b/,
    /\bthey\s+(sacked|fired|dismissed)\s+me\b/,
    /\bunfair\s+dismissal\b/,
    /\bconstructive\s+dismissal\b/,
    /\bforce[d]?\s+(me\s+)?to\s+resign\b/,
    /\btrying\s+to\s+(force|make)\s+me\s+(to\s+)?resign\b/,
    /\bunpaid\s+(overtime|wages|pay|salary)\b/,
    /\bhaven'?t\s+paid\s+my\s+(wage|wages|pay|salary|overtime)\b/,
    /\bi'?m\s+(an?\s+)?(employee|worker)\b/,
    /\bi\s+am\s+(an?\s+)?(employee|worker)\b/,
    /\bi\s+(work|worked|have\s+worked)\s+(for|at)\b/,
    /\bemployment\s+tribunal\b/,
  ]
  if (patterns.some((re) => re.test(t))) return true
  if (/\bacas\b/.test(t) && /\b(my|me|i|unfair|dismiss|sack|wage)\b/.test(t)) return true
  if (/\bstill\s+working\b/.test(t) && /\b(sack|redundan|hr|dismiss)/.test(t)) return true
  if (/\bi'?m\s+\d+\s+weeks?\s+pregnant\b/.test(t) && /\b(employer|redundan|job|work)\b/.test(t)) {
    return true
  }
  if (/\bredundancy\b/.test(t) && /\b(retain\s+me|keep\s+me|my\s+redundancy|package)\b/.test(t)) {
    return true
  }
  if (/\bwages?\b/.test(t) && /\b(my|me|i)\b/.test(t)) return true
  return false
}

function hasOtherSideEmployerParty(session: SessionState): boolean {
  // senseDetails often adds { label: 'Employer', role: 'employer' } for the *other* party
  return session.parties.some((p) => {
    const role = (p.role || '').toLowerCase()
    const label = (p.label || '').toLowerCase()
    return role === 'employer' || label === 'employer'
  })
}

function employmentContext(session: SessionState, t: string): boolean {
  return (
    session.matterType === 'employment' ||
    hasOtherSideEmployerParty(session) ||
    /\b(employment|employer|employee|sacked|dismiss|redundan|tribunal|acas|wages|overtime|constructive)\b/.test(
      t,
    )
  )
}

/**
 * Infer the *user's* role for CAQI chips.
 * Party roles are usually the other side — never map party `employer` → user employer.
 */
export function inferUserRole(session: SessionState): UserRoleHint {
  if (session.confirmedUserRole && session.confirmedUserRole !== 'unset') {
    return session.confirmedUserRole
  }

  const t = blob(session)
  const roles = session.parties.map((p) => (p.role || p.label).toLowerCase())

  if (roles.some((r) => /tenant|renter/.test(r)) || /\btenant\b|my landlord|section\s*21|deposit/.test(t)) {
    // Prefer tenant over employment if both somehow present
    if (!isEmployeeVoice(t) && !isEmployerVoice(t)) return 'tenant'
    if (/\bmy landlord\b|section\s*21|deposit|tenant/.test(t) && !employmentContext(session, t)) {
      return 'tenant'
    }
  }
  if (roles.some((r) => /^landlord$/.test(r)) || /\bi am (the )?landlord\b|my tenant/.test(t)) {
    if (/\bi am (the )?landlord\b|my tenant/.test(t)) return 'landlord'
  }

  // Employment: narrative first. Employer only on clear employer voice.
  if (isEmployerVoice(t)) return 'employer'
  if (isEmployeeVoice(t)) return 'employee'
  // Employment context + first-person / collective worker cues, without employer voice
  if (
    employmentContext(session, t) &&
    /\b(job|work|shift|hr|contract|notice|overtime)\b/.test(t) &&
    /\b(i|i'?m|my|me|us|we)\b/.test(t)
  ) {
    return 'employee'
  }

  if (/\bilr\b|visa|home office|asylum|settled status|leave to remain/.test(t)) return 'immigrant_applicant'
  if (/\brefund\b|faulty|trader|consumer|warranty/.test(t)) return 'consumer'
  if (/\bchild\b|spouse|partner|parent|trust fund|inheritance/.test(t)) return 'family_member'
  return 'unknown'
}

/** True when employment-ish narrative has no reliable employee/employer signal. */
export function needsEmploymentRoleClarify(session: SessionState): boolean {
  if (session.confirmedUserRole && session.confirmedUserRole !== 'unset') return false
  const t = blob(session)
  if (!employmentContext(session, t)) return false
  const role = inferUserRole(session)
  return role === 'unknown'
}

export function inferSearchIntent(session: SessionState): SearchIntent {
  const t = blob(session)
  if (session.mode === 'research' || session.mode === 'browse' || session.mode === 'info') {
    if (!/\bhow (do|can|should) i\b|what (are )?my (options|rights)|can (they|i|he|she)\b/.test(t)) {
      return 'interest_browse'
    }
  }
  if (
    /\b(form|application|portal|phone number|website|link|find (a |an )?(solicitor|adviser|lawyer))\b/.test(t) ||
    /\bwhich (page|site|scheme)\b/.test(t)
  ) {
    return 'particular_resource'
  }
  if (
    /\bhow (do|can|should) i\b|what (do|should) i do|next step|process|procedure|appeal|tribunal|acas|complain|challenge|apply/.test(
      t,
    )
  ) {
    return 'procedure'
  }
  if (
    /\bcompensat|damages|refund|deposit back|redundancy pay|settlement|sentence|fine|penalty|evict|repossess|keep my/.test(
      t,
    )
  ) {
    return 'remedy_outcome'
  }
  if (
    /\bis (this|it|that) (legal|lawful|allowed)|what (kind|type) of|does this (count|mean)|constructive dismissal|unfair dismissal|character|suitability/.test(
      t,
    )
  ) {
    return 'characterization'
  }
  // Default: figure out the legal frame
  if (session.mode === 'dispute' || session.mode === 'urgent') return 'procedure'
  return 'characterization'
}

export function inferUrgency(session: SessionState): SearchContextProfile['urgency'] {
  if (session.safetyRisk || session.mode === 'urgent') return 'urgent'
  const t = blob(session)
  if (
    /\brepossess|bailiff|evict|deport|detention|tonight|tomorrow|court (date|hearing)|deadline|limitation|time limit/.test(
      t,
    )
  ) {
    return 'elevated'
  }
  return 'normal'
}

export function buildSearchContextProfile(session: SessionState): SearchContextProfile {
  const role = inferUserRole(session)
  const intent = inferSearchIntent(session)
  const urgency = inferUrgency(session)
  const taxTokens = [
    session.ukTaxonomyL1 ? `tax_l1:${session.ukTaxonomyL1}` : '',
    session.ukTaxonomyL2 ? `tax_l2:${session.ukTaxonomyL2}` : '',
    session.ukTaxonomyPackId ? `pack:${session.ukTaxonomyPackId}` : '',
    session.ukTaxonomyConfidence >= 0.85
      ? 'tax_conf:high'
      : session.ukTaxonomyConfidence >= 0.55
        ? 'tax_conf:mid'
        : '',
  ].filter(Boolean)

  const authTokens = [
    session.authorityHits?.length ? `authority_hits:${session.authorityHits.length}` : '',
    session.authorityAuditOk ? 'authority_audit:ok' : '',
  ].filter(Boolean)

  const tokens = [
    session.jurisdiction !== 'Unknown' ? `jurisdiction:${session.jurisdiction}` : '',
    session.locationHint ? `location:${session.locationHint}` : '',
    session.matterType !== 'unknown' ? `matter:${session.matterType}` : '',
    session.mode !== 'unknown' ? `mode:${session.mode}` : '',
    role !== 'unknown' ? `role:${role}` : '',
    `intent:${intent}`,
    `urgency:${urgency}`,
    ...taxTokens,
    ...authTokens,
  ].filter(Boolean)

  return {
    jurisdiction: session.jurisdiction,
    locationHint: session.locationHint,
    matterType: session.matterType,
    mode: session.mode,
    role,
    urgency,
    intent,
    tokens,
    abPrimaryMetric: INTENT_METRIC[intent],
  }
}

/** Human-readable chips for UI */
export function contextChips(profile: SearchContextProfile): string[] {
  const chips: string[] = []
  if (profile.jurisdiction === 'EnglandWales') chips.push('England & Wales')
  else if (profile.jurisdiction === 'Scotland') chips.push('Scotland')
  else if (profile.jurisdiction === 'NorthernIreland') chips.push('Northern Ireland')
  if (profile.matterType !== 'unknown') chips.push(profile.matterType.replace(/_/g, ' '))
  if (profile.role !== 'unknown') chips.push(profile.role.replace(/_/g, ' '))
  const pack = profile.tokens.find((t) => t.startsWith('pack:'))
  if (pack) chips.push(pack.replace('pack:', '').replace(/_/g, ' '))
  chips.push(profile.intent.replace(/_/g, ' '))
  if (profile.urgency !== 'normal') chips.push(profile.urgency)
  return chips
}

/** Build a minimal session for offline role tests. */
export function sessionForRoleTest(
  text: string,
  extras?: Partial<Pick<SessionState, 'matterType' | 'parties' | 'confirmedUserRole' | 'rawInputs' | 'whatHappened'>>,
): SessionState {
  return {
    rawInputs: extras?.rawInputs ?? [text],
    events: [],
    whatHappened: extras?.whatHappened ?? text,
    howCaused: '',
    goal: '',
    parties: extras?.parties ?? [],
    documents: [],
    matterType: extras?.matterType ?? 'unknown',
    jurisdiction: 'Unknown',
    locationHint: '',
    mode: 'unknown',
    searchMode: 'umbra',
    penumbraAcknowledged: false,
    softFlags: [],
    safetyRisk: false,
    answeredPromptIds: [],
    confirmedSearchQuery: '',
    reformulationOutcome: 'none',
    styleTranslatedQuery: '',
    searchContextTokens: [],
    searchIntent: 'unknown',
    abPrimaryMetric: 'unset',
    confirmedUserRole: extras?.confirmedUserRole ?? 'unset',
    ukTaxonomyL1: '',
    ukTaxonomyL2: '',
    ukTaxonomyPackId: '',
    ukTaxonomyConfidence: 0,
    authorityAnswers: [],
    authorityHits: [],
    authorityAuditOk: false,
  }
}
