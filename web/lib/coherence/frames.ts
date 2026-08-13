import type { MatterType, Mode, SessionState } from './types'
import { maximiseLocalCoherence, type WikiCandidate } from './coherence'

export interface LegalFrame {
  id: string
  label: string
  why: string
  score: number
  /** Phase 3 local fit (0–100), set after coherence pass */
  fitScore?: number
  unmetConstraints?: string[]
}

function textBlob(session: SessionState): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => e.label),
    ...session.softFlags,
  ]
    .join(' ')
    .toLowerCase()
}

/** Propose 2–3 competing legal frames (triage hypotheses — not advice). */
export function proposeLegalFrames(session: SessionState, limit = 3): LegalFrame[] {
  const t = textBlob(session)
  const matter: MatterType = session.matterType
  const frames: LegalFrame[] = []

  const add = (id: string, label: string, why: string, score: number) => {
    if (frames.some((f) => f.id === id)) return
    frames.push({ id, label, why, score })
  }

  const immKw =
    /\bilr\b|visa|home office|asylum|deport|immigration|indefinite leave|settled status|leave to remain/.test(
      t,
    )
  // Immigration only when matter says so, or unknown with clear imm keywords (not bare "refused")
  const useImm = matter === 'immigration' || (matter === 'unknown' && immKw)

  if (useImm) {
    if (/refus|reject|review|appeal/.test(t) || (/tribunal/.test(t) && immKw)) {
      add(
        'imm-challenge',
        'Challenge a visa / leave decision',
        'Client describes a refusal or wants review / appeal / tribunal pathways.',
        90,
      )
    }
    if (/\bilr\b|indefinite leave|settlement|settled status/.test(t)) {
      add(
        'imm-settlement',
        'Settlement / ILR / settled status',
        'Narrative centres on indefinite leave, settlement, or settled status.',
        86,
      )
    }
    if (/asylum|refugee|scared to go back|protect/.test(t)) {
      add(
        'imm-asylum',
        'Asylum / protection',
        'Client mentions fear of return, asylum, or protection needs.',
        88,
      )
    }
    if (/family|spouse|partner|child|join/.test(t)) {
      add(
        'imm-family',
        'Family / partner route',
        'Goal or events involve joining or remaining with family in the UK.',
        78,
      )
    }
    if (/deport|remov|detain|return/.test(t)) {
      add(
        'imm-return',
        'Return / removal history',
        'Past deportation or removal is part of the story.',
        82,
      )
    }
    if (/character|suitability|criminal|conviction/.test(t)) {
      add(
        'imm-suitability',
        'Suitability / character issues',
        'Client raised character or suitability as a live issue (stated, not a finding).',
        80,
      )
    }
    if (/adviser|solicitor|find|near me|regulated/.test(t) || session.mode === 'browse') {
      add(
        'imm-adviser',
        'Find a regulated immigration adviser',
        'Immediate need may be locating regulated help rather than litigating a decision.',
        70,
      )
    }
    if (frames.length === 0) {
      add(
        'imm-general',
        'UK immigration status / application',
        'Matter typed as immigration; frame will refine as more detail lands on the timeline.',
        60,
      )
    }
  } else if (
    matter === 'housing' ||
    /landlord|tenant|evict|mould|section\s*21|disrepair|tenancy|\brents?\b/.test(t)
  ) {
    if (/evict|lock(?:ed)?(?:\s+\w+){0,2}\s*out|possession|section\s*21|section\s*8|bailiff/.test(t)) {
      add('hous-possession', 'Possession / eviction risk', 'Eviction or lock-out language suggests possession urgency.', 88)
    }
    // Word-bound repairs — bare "repair" is too broad; never match via other domains' vocabulary
    if (/disrepair|mould|mold|damp|\brepairs?\b|heating|leaking/.test(t) && !/flatmate|housemate|lodger|lashing out|notice to quit/.test(t)) {
      add('hous-disrepair', 'Disrepair / landlord duties', 'Housing conditions or landlord response feature in the account.', 84)
    }
    // Shared housing / flatmate — before deposit/rent so "share of the rent" does not become arrears-only.
    if (
      /flatmate|housemate|lodger|subtenant|excluded occupier|share[d]?\s+accommodation|joint tenancy|licence to occupy|notice to quit/.test(
        t,
      )
    ) {
      add(
        'hous-shared',
        'Shared accommodation / flatmate',
        'Shared housing, lodger, or flatmate dispute — status and household agreements matter more than generic rent arrears.',
        90,
      )
    }
    // Require deposit / arrears language — bare "rent" (incl. share of rent) is too broad.
    if (/deposit|rent.?arrears|arrears|housing benefit|deposit.?protection|holding.?deposit/.test(t)) {
      add('hous-deposit', 'Tenancy money / deposit', 'Deposit protection or rent-arrears language is present.', 72)
    }
    if (/homeless|sofa|no where to stay|rough sleep/.test(t)) {
      add('hous-homeless', 'Homelessness / housing duty', 'Client may need local authority homelessness pathways.', 86)
    }
    if (frames.length === 0) {
      add('hous-general', 'Housing / landlord–tenant', 'Matter typed as housing; frame will refine with more detail.', 60)
    }
  } else if (matter === 'employment' || /employer|dismiss|fired|redundan|wages/.test(t)) {
    if (/dismiss|fired|sacked|constructive/.test(t)) {
      add('emp-unfair', 'Unfair / wrongful dismissal', 'Job loss language may engage dismissal rights.', 86)
    }
    if (/wage|pay|holiday|contract|hours/.test(t)) {
      add('emp-wages', 'Pay / contract issues', 'Wages or contract problems can sit alongside dismissal.', 78)
    }
    if (/discriminat|harass|bully|whistle/.test(t)) {
      add('emp-discrim', 'Workplace discrimination / harassment', 'Equality or harassment issues may need early specialist framing.', 80)
    }
    if (/tribunal|acas|claim/.test(t) || frames.length > 0) {
      add('emp-tribunal', 'Employment tribunal pathways', 'Employment disputes often need early ACAS / tribunal framing.', 70)
    }
    if (frames.length === 0) {
      add('emp-general', 'Employment rights', 'Matter typed as employment; frame will refine with more detail.', 60)
    }
  } else if (matter === 'debt' || /debt|bailiff|ccj|creditor/.test(t)) {
    if (/bailiff|enforcement|warrant|charging order/.test(t)) {
      add('debt-enforcement', 'Debt enforcement / bailiffs', 'Enforcement action is live or threatened.', 88)
    }
    if (/ccj|county court|judgment/.test(t)) {
      add('debt-ccj', 'County court judgment (CCJ)', 'A CCJ or court claim features in the story.', 84)
    }
    if (/afford|budget|iva|bankruptcy|debt relief|dro/.test(t)) {
      add('debt-solution', 'Debt solutions / breathing space', 'Client may need breathing space or formal debt options.', 76)
    }
    if (frames.length === 0) {
      add('debt-general', 'Debt / money problems', 'Matter typed as debt; frame will refine with more detail.', 60)
    }
  } else if (matter === 'family' || /divorce|custody|child arrangement|child contact|domestic|partner left/.test(t)) {
    if (/child|custody|contact|arrangement|care order/.test(t)) {
      add('fam-children', 'Children / arrangements', 'Child arrangements or care concerns are central.', 86)
    }
    if (/divorce|separat|finances|ancillary/.test(t)) {
      add('fam-divorce', 'Divorce / separation finances', 'Relationship breakdown and finances feature.', 80)
    }
    if (/domestic|abuse|injunction|non-molestation|harass/.test(t)) {
      add('fam-domestic', 'Domestic abuse / protective orders', 'Safety and protective orders may be urgent.', 90)
    }
    if (frames.length === 0) {
      add('fam-general', 'Family law triage', 'Matter typed as family; frame will refine with more detail.', 60)
    }
  } else if (
    matter === 'crime' ||
    /driving ban|disqualif|banned from driving|motoring|highway code|in charge of (?:the )?vehicle|in control of (?:the )?vehicle|sentenc|magistrates|arrest|criminal|offence/.test(
      t,
    )
  ) {
    if (/driving ban|disqualif|banned from driving|in charge of|in control of|tyre|inflate|engine on|driveway/.test(t)) {
      add(
        'crime-motoring',
        'Driving ban / in charge of a vehicle',
        'Disqualification or “in charge” of a vehicle while banned is the live issue.',
        92,
      )
    }
    if (/sentenc|magistrates|guilty|plea|conviction/.test(t)) {
      add('crime-sentence', 'Sentencing / court outcome', 'Court sentence or guidelines may be relevant.', 78)
    }
    if (/arrest|charg(?:ed|e)|accused|police interview|bail/.test(t)) {
      add('crime-accused', 'Accused / police investigation', 'Client may be under investigation or charged.', 80)
    }
    if (/victim|witness|assault|theft/.test(t)) {
      add('crime-victim', 'Victim / witness support', 'Victim or witness pathways may apply.', 72)
    }
    if (frames.length === 0) {
      add('crime-general', 'Crime / police triage', 'Matter typed as crime; frame will refine with more detail.', 60)
    }
  } else if (
    matter === 'consumer' ||
    (/refund|faulty|trader|warranty|guarantee|garage|washing machine|refuse to fix|dealer|fault codes?|\bbattery\b|broke down|not as described|bought.*\b(car|vehicle)\b/.test(
      t,
    ) &&
      !/driving ban|disqualif|banned from driving|in charge of|in control of/.test(t))
  ) {
    if (/refund|cancel|return|chargeback/.test(t)) {
      add('cons-refund', 'Refund / cancellation', 'Client wants money back or to cancel a contract.', 84)
    }
    if (
      /faulty|broken|not as described|guarantee|warranty|broke down|bad service|refuse to fix|fault codes?|\bbattery\b/.test(
        t,
      )
    ) {
      add('cons-faulty', 'Faulty goods / services', 'Quality or description problems with goods or services.', 82)
    }
    if (/trader|scam|mis-sell|unfair term|dealer|garage/.test(t)) {
      add('cons-trader', 'Trader / unfair practices', 'Trader conduct or unfair terms may need escalation pathways.', 76)
    }
    if (frames.length === 0) {
      add('cons-general', 'Consumer rights', 'Matter typed as consumer; frame will refine with more detail.', 60)
    }
  } else if (matter === 'personal_injury') {
    add('pi-employer', 'Workplace / employer duty', 'Injury narrative may engage employer health & safety duties.', 85)
    add('pi-third', 'Third-party accident', 'Another party may share or hold liability depending on how it happened.', 72)
    add('pi-claim', 'Personal injury claim pathways', 'Client may want solicitor assessment of a PI claim.', 68)
  } else if (matter === 'conveyancing' || session.mode === 'browse') {
    add('conv-purchase', 'Buying / selling property', 'Browse-style need for conveyancing or property transaction help.', 75)
    add('conv-compare', 'Compare regulated conveyancers', 'Client may want directory-style comparison, not dispute intake.', 70)
  } else {
    add('gen-advice', 'General legal triage', 'Matter still broad — frames will narrow once type and goal firm up.', 50)
    add('gen-directory', 'Find regulated help', 'Signposting to regulated advisers / solicitors may be the first need.', 48)
  }

  return frames.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Phase 1 propose → Phase 3 local coherence re-rank.
 * Pass wiki candidates when available (Phase 2); otherwise story-only fit.
 */
export function proposeCoherentFrames(
  session: SessionState,
  limit = 3,
  candidates: WikiCandidate[] = [],
): LegalFrame[] {
  // Over-propose then let local maximiser pick plural tops
  const proposed = proposeLegalFrames(session, Math.max(limit + 2, 5))
  return maximiseLocalCoherence(session, proposed, candidates, limit).frames
}

export function modeLabel(mode: Mode): string {
  const map: Record<Mode, string> = {
    browse: 'Browse services',
    dispute: 'Explain what happened',
    info: 'Information only',
    research: 'OSLAW — open-source research',
    urgent: 'Urgent / safety',
    unknown: 'Not chosen yet',
  }
  return map[mode]
}
