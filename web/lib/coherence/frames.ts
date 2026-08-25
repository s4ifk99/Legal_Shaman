import type { MatterType, Mode, SessionState } from './types'
import { maximiseLocalCoherence, type WikiCandidate } from './coherence'
import { buildRetrievalText } from './retrievalText'
import { looksNeighbourDispute } from './sense'
import { classifyUkTaxonomy, type UkTaxonomyHit } from './ukTaxonomy'

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
  return buildRetrievalText(session)
}

function sessionTaxonomy(session: SessionState, t: string): UkTaxonomyHit | null {
  if (session.ukTaxonomyPackId && session.ukTaxonomyL2) {
    const live = classifyUkTaxonomy(t)
    if (live && live.confidence >= (session.ukTaxonomyConfidence || 0)) return live
  }
  return classifyUkTaxonomy(t)
}

function applyMatterPackFrames(
  add: (id: string, label: string, why: string, score: number) => void,
  tax: UkTaxonomyHit,
) {
  switch (tax.packId) {
    case 'mortgage_possession':
      add(
        'debt-mortgage-possession',
        'Mortgage possession / repossession risk',
        'Lender repossession or mortgage shortfall language — urgent secured-debt pathways.',
        94,
      )
      break
    case 'police_property_seizure':
      add(
        'crime-property-seizure',
        'Police property seizure / return',
        'Police confiscated or retained property; challenge / return paperwork may be needed.',
        94,
      )
      add('crime-police', 'Police powers / process', 'Police involvement is central to the story.', 80)
      break
    case 'neighbour_dispute':
      add(
        'hous-neighbour',
        'Neighbour dispute / access',
        'Neighbour parking, access, boundary, or nuisance — not a landlord–tenant dispute.',
        92,
      )
      break
    case 'joint_tenancy_liability':
      add(
        'hous-joint-liability',
        'Joint tenancy / shared rent liability',
        'Flatmate or joint tenants on the same tenancy — liability for the whole rent may be the core issue.',
        93,
      )
      break
    case 'trusts_ctf':
      add(
        'fam-trusts-ctf',
        'Child Trust Fund / trust money',
        'CTF or trust fund control dispute — private-client framing, not general advice only.',
        92,
      )
      break
    case 'inheritance_succession':
      add(
        'fam-inheritance',
        'Inheritance / estate claim',
        'Parents’ estate, probate, or sibling claim over a house / share.',
        92,
      )
      break
    case 'pregnancy_redundancy':
      add(
        'emp-pregnancy',
        'Pregnancy / maternity & redundancy',
        'Pregnancy or maternity overlapping redundancy or dismissal needs dedicated framing.',
        94,
      )
      break
    default:
      break
  }
}

/** Propose 2–3 competing legal frames (triage hypotheses — not advice). */
export function proposeLegalFrames(session: SessionState, limit = 3): LegalFrame[] {
  const t = textBlob(session)
  const matter: MatterType = session.matterType
  const tax = sessionTaxonomy(session, t)
  const frames: LegalFrame[] = []

  const add = (id: string, label: string, why: string, score: number) => {
    if (frames.some((f) => f.id === id)) return
    frames.push({ id, label, why, score })
  }

  // Private parking / PCN — before consumer "car" heuristics (car park ≠ used car).
  if (
    /\b(parking (?:fine|ticket|charge|app|company)|car\s*park|pcn|popla|private parking)\b/.test(t)
  ) {
    add(
      'cons-parking',
      'Parking charge / ticket appeal',
      'Private car park or parking charge / PCN appeal features in the account.',
      92,
    )
  }

  if (tax && tax.confidence >= 0.8) {
    applyMatterPackFrames(add, tax)
  }

  const immKw =
    /\bilr\b|visa|home office|asylum|deport|immigration|indefinite leave|settled status|leave to remain/.test(
      t,
    )
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
    (matter === 'housing' ||
      tax?.l1 === 'property' ||
      /landlord|tenant|evict|mould|section\s*21|disrepair|tenancy|\brents?\b|flatmate|housemate/.test(t)) &&
    !(
      /\b(\d+\s*year\s*old|my (?:son|daughter|kid|child))\b/i.test(t) &&
      /\b(my ex|ex[- ]?(?:partner|wife|husband)|his mum|her boyfriend)\b/i.test(t)
    )
  ) {
    if (
      /flatmate|housemate|joint\s+tenant|both\s+on\s+the\s+tenancy|jointly\s+liable/.test(t) ||
      tax?.packId === 'joint_tenancy_liability'
    ) {
      add(
        'hous-joint-liability',
        'Joint tenancy / shared rent liability',
        'Flatmate or joint tenants — liability for the whole rent may be the core issue.',
        93,
      )
    }
    if (/evict|lock(?:ed)?(?:\s+\w+){0,2}\s*out|possession|section\s*21|section\s*8|bailiff/.test(t)) {
      add('hous-possession', 'Possession / eviction risk', 'Eviction or lock-out language suggests possession urgency.', 88)
    }
    if (/disrepair|mould|mold|damp|\brepairs?\b|heating|leaking/.test(t)) {
      add('hous-disrepair', 'Disrepair / landlord duties', 'Housing conditions or landlord response feature in the account.', 84)
    }
    if (/deposit|\brents?\b|arrears|housing benefit/.test(t)) {
      add('hous-deposit', 'Tenancy money / deposit', 'Rent or deposit disputes are a common parallel frame.', 72)
    }
    if (/homeless|sofa|no where to stay|rough sleep/.test(t)) {
      add('hous-homeless', 'Homelessness / housing duty', 'Client may need local authority homelessness pathways.', 86)
    }
    if (looksNeighbourDispute(t) || tax?.l2 === 'neighbour_dispute' || tax?.packId === 'neighbour_dispute') {
      add(
        'hous-neighbour',
        'Neighbour dispute / access',
        'Neighbour parking, driveway, boundary, noise, or access — not landlord–tenant.',
        92,
      )
    }
    if (frames.length === 0) {
      add('hous-general', 'Housing / landlord–tenant', 'Matter typed as housing; frame will refine with more detail.', 60)
    }
  } else if (
    matter === 'employment' ||
    tax?.l1 === 'employment' ||
    ((/\b(dismiss|fired|sacked|redundan|unfair dismiss|constructive dismiss|unpaid wages|holiday (?:hours|pay)|employment tribunal|acas)\b/i.test(
      t,
    ) ||
      (/\b(manager|supervisor|boss|line manager)\b/i.test(t) &&
        /\b(holiday|shift|hours|appointment|drinking water|wage|pay)\b/i.test(t))) &&
      !(
        /\b(insurer|insurance (?:company|claim|policy)|festival|day ticket|wheelchair|airport)\b/i.test(t) &&
        !/\b(dismiss|sacked|fired|redundan|holiday hours|holiday pay)\b/i.test(t)
      ))
  ) {
    if (/pregnant|pregnancy|maternity/.test(t) || tax?.packId === 'pregnancy_redundancy') {
      add(
        'emp-pregnancy',
        'Pregnancy / maternity & redundancy',
        'Pregnancy or maternity overlapping job loss or redundancy.',
        94,
      )
    }
    if (/dismiss|fired|sacked|constructive|redundan/.test(t)) {
      add('emp-unfair', 'Unfair / wrongful dismissal', 'Job loss language may engage dismissal rights.', 86)
    }
    if (/wage|pay|holiday|contract|hours|shift|appointment|drinking water/.test(t)) {
      add(
        'emp-wages',
        'Pay / contract / workplace conditions',
        'Pay, hours, leave or workplace conditions feature in the account.',
        78,
      )
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
  } else if (
    matter === 'debt' ||
    tax?.l1 === 'debt_insolvency' ||
    /debt|bailiff|ccj|creditor|mortgage|repossess/.test(t)
  ) {
    if (/\bmortgage\b|repossess/.test(t) || tax?.packId === 'mortgage_possession') {
      add(
        'debt-mortgage-possession',
        'Mortgage possession / repossession risk',
        'Lender repossession or mortgage shortfall language.',
        94,
      )
    }
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
  } else if (
    matter === 'family' ||
    tax?.l1 === 'private_client' ||
    /divorce|custody|child arrangement|child contact|domestic|partner left|inherit|trust fund|\bctf\b|probate/.test(
      t,
    ) ||
    (/\b(\d+\s*year\s*old|my (?:son|daughter|kid|child))\b/i.test(t) &&
      /\b(my ex|ex[- ]?(?:partner|wife|husband)|his mum|her boyfriend|boyfriend'?s kid)\b/i.test(t))
  ) {
    if (/child trust fund|\bctf\b|junior isa|trust fund/.test(t) || tax?.packId === 'trusts_ctf') {
      add(
        'fam-trusts-ctf',
        'Child Trust Fund / trust money',
        'CTF or trust fund control dispute.',
        92,
      )
    }
    if (
      /inherit|probate|estate|intestat/.test(t) ||
      tax?.packId === 'inheritance_succession' ||
      (/parents?/.test(t) && /house|home|property/.test(t) && /share|claim|sibling|brother|sister/.test(t))
    ) {
      add(
        'fam-inheritance',
        'Inheritance / estate claim',
        'Estate, probate, or family claim over property.',
        92,
      )
    }
    if (
      /\b(threw|broke|broken|taken it off|sue|get (?:it|them) (?:back|fixed)|Switch|console|toy|gift)\b/i.test(
        t,
      ) &&
      /\b(ex|mum|mom|son|daughter|kid|child)\b/i.test(t)
    ) {
      add(
        'fam-property-dispute',
        'Child’s belongings / parental property dispute',
        'Dispute between parents over a child’s gift or belongings (possible small claim; family context first).',
        96,
      )
    }
    // Only surface child-arrangements when that is actually asked — not for gift/damage stories
    if (
      /custody|contact order|child arrangement|care order|living arrangements|who (?:the child|they) (?:live|lives) with/.test(
        t,
      ) ||
      (/child|year old|son|daughter/.test(t) &&
        !/\b(threw|broke|broken|taken it off|sue|get (?:it|them) (?:back|fixed)|Switch|console|toy|gift)\b/i.test(t))
    ) {
      add('fam-children', 'Children / arrangements', 'Child arrangements or care concerns are central.', 86)
    }
    if (/divorce|separat|finances|ancillary/.test(t)) {
      add('fam-divorce', 'Divorce / separation finances', 'Relationship breakdown and finances feature.', 80)
    }
    if (/domestic\s*abuse|abuse|injunction|non-molestation|harass/.test(t)) {
      add('fam-domestic', 'Domestic abuse / protective orders', 'Safety and protective orders may be urgent.', 90)
    }
    if (frames.length === 0) {
      add('fam-general', 'Family law triage', 'Matter typed as family; frame will refine with more detail.', 60)
    }
  } else if (
    matter === 'crime' ||
    tax?.l1 === 'crime_public' ||
    /police|arrest|criminal|offence|confiscat|seiz/.test(t)
  ) {
    if (
      /confiscat|seiz|took my|get (it|them|my \w+) back/.test(t) ||
      tax?.packId === 'police_property_seizure'
    ) {
      add(
        'crime-property-seizure',
        'Police property seizure / return',
        'Police retained or confiscated property.',
        94,
      )
    }
    add('crime-police', 'Police powers / process', 'Police or criminal process features in the account.', 78)
    if (frames.length === 0) {
      add('crime-general', 'Crime / police triage', 'Matter typed as crime; frame will refine with more detail.', 60)
    }
  } else if (
    matter === 'consumer' ||
    /refund|faulty|trader|warranty|guarantee|garage|washing machine|refuse to fix|used car|bought .{0,20}(?:car|vehicle)|\bvehicle\b|dealer|fault codes?|\bbattery\b|insurer|insurance|festival|day ticket|wheelchair|airport/.test(
      t,
    )
  ) {
    const parkingOnly =
      /\b(parking (?:fine|ticket|charge|app|company)|car\s*park|pcn|popla)\b/.test(t) &&
      !/\b(used car|bought .{0,20}(?:car|vehicle)|dealer|fault codes?|washing machine)\b/.test(t)
    if (
      /\b(insurer|insurance (?:company|claim|policy)|private medical)\b/i.test(t) ||
      (/\b(insurance|policy)\b/i.test(t) && /\b(operation|hospital|won'?t pay|approved|cover)\b/i.test(t))
    ) {
      add(
        'cons-insurance',
        'Insurance / medical funding dispute',
        'Insurer approval, cover refusal or medical funding features in the account.',
        90,
      )
    }
    if (
      /\b(wheelchair|disabled|disability|blue badge|accessibility|stranded)\b/i.test(t) ||
      (/\bairport\b/i.test(t) && /\b(access|assistance|check-?in|wheelchair)\b/i.test(t))
    ) {
      add(
        'cons-access',
        'Disability / access rights',
        'Disability access, assistance or equal treatment in services/travel.',
        88,
      )
    }
    if (/\b(festival|concert|day ticket|ticket holders?|advertised artists?|\bgig\b)\b/i.test(t)) {
      add(
        'cons-tickets',
        'Event tickets / advertised services',
        'Ticketed event or advertised service not matching what was sold.',
        86,
      )
    }
    if (/refund|cancel|return|chargeback/.test(t) && !parkingOnly) {
      add('cons-refund', 'Refund / cancellation', 'Client wants money back or to cancel a contract.', 84)
    }
    if (
      !parkingOnly &&
      /faulty|broken|not as described|guarantee|warranty|broke down|bad service|refuse to fix|fault codes?|\bbattery\b/.test(
        t,
      )
    ) {
      add('cons-faulty', 'Faulty goods / services', 'Quality or description problems with goods or services.', 82)
    }
    if (!parkingOnly && /trader|scam|mis-sell|unfair term|dealer|garage/.test(t)) {
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
