/**
 * Sargeant-inspired UK law topic taxonomy (L1/L2) → matter packs.
 * Heuristic classifier first; optional LLM hook for later.
 * arXiv:2405.12910 / AI & Law 2025.
 */

import type { MatterType } from './types'

/** Coarse L1 areas adapted from Sargeant UK taxonomy for lay A2J routing. */
export type UkTaxonomyL1 =
  | 'property'
  | 'employment'
  | 'private_client'
  | 'crime_public'
  | 'debt_insolvency'
  | 'family'
  | 'immigration'
  | 'personal_consumer'
  | 'commercial'
  | 'unknown'

export type UkTaxonomyL2 =
  | 'landlord_tenant'
  | 'joint_tenancy'
  | 'deposit_protection'
  | 'possession_eviction'
  | 'mortgage_possession'
  | 'conveyancing'
  | 'unfair_dismissal'
  | 'wages_contract'
  | 'pregnancy_maternity'
  | 'trusts_ctf'
  | 'inheritance_succession'
  | 'police_property_seizure'
  | 'criminal_general'
  | 'debt_enforcement'
  | 'consumer_goods'
  | 'immigration_status'
  | 'family_children'
  | 'unknown'

export type MatterPackId =
  | 'joint_tenancy_liability'
  | 'deposit_protection'
  | 'possession_eviction'
  | 'mortgage_possession'
  | 'police_property_seizure'
  | 'trusts_ctf'
  | 'inheritance_succession'
  | 'pregnancy_redundancy'
  | 'unfair_dismissal'
  | 'general'

export type WikiDomainHint =
  | 'housing'
  | 'employment'
  | 'debt'
  | 'family'
  | 'crime'
  | 'consumer'
  | 'immigration'

export interface UkTaxonomyHit {
  l1: UkTaxonomyL1
  l2: UkTaxonomyL2
  confidence: number
  matterType: MatterType
  packId: MatterPackId
  /** Preferred frame ids for this pack (highest first) */
  frameIds: string[]
  wikiDomains: WikiDomainHint[]
  reasons: string[]
}

interface Rule {
  l1: UkTaxonomyL1
  l2: UkTaxonomyL2
  packId: MatterPackId
  matterType: MatterType
  frameIds: string[]
  wikiDomains: WikiDomainHint[]
  weight: number
  test: (t: string) => boolean
  reason: string
}

const RULES: Rule[] = [
  {
    l1: 'debt_insolvency',
    l2: 'mortgage_possession',
    packId: 'mortgage_possession',
    matterType: 'debt',
    frameIds: ['debt-mortgage-possession', 'debt-enforcement', 'debt-general'],
    wikiDomains: ['debt', 'housing'],
    weight: 0.96,
    reason: 'Mortgage / repossession',
    test: (t) =>
      /\bmortgage\b/.test(t) &&
      /\b(repossess|repossession|possession|shortfall|lender|bank)\b/.test(t),
  },
  {
    l1: 'crime_public',
    l2: 'police_property_seizure',
    packId: 'police_property_seizure',
    matterType: 'crime',
    frameIds: ['crime-property-seizure', 'crime-police', 'crime-general'],
    wikiDomains: ['crime'],
    weight: 0.95,
    reason: 'Police seized / confiscated property',
    test: (t) =>
      /\bpolice\b/.test(t) &&
      /\b(confiscat\w*|seiz(?:e|ed|ure)|took\s+(my|the)\s+\w+|retain(?:ed|ing)\s+(my|the))\b/.test(t),
  },
  {
    l1: 'private_client',
    l2: 'trusts_ctf',
    packId: 'trusts_ctf',
    matterType: 'family',
    frameIds: ['fam-trusts-ctf', 'fam-children', 'fam-general'],
    wikiDomains: ['family'],
    weight: 0.94,
    reason: 'Child Trust Fund / trust money',
    test: (t) => /\b(child\s+trust\s+fund|\bctf\b|junior\s+isa|trust\s+fund)\b/.test(t),
  },
  {
    l1: 'private_client',
    l2: 'inheritance_succession',
    packId: 'inheritance_succession',
    matterType: 'family',
    frameIds: ['fam-inheritance', 'fam-general'],
    wikiDomains: ['family'],
    weight: 0.93,
    reason: 'Inheritance / probate / parents’ estate',
    test: (t) =>
      /\b(inherit|inheritance|probate|intestat|last\s+will|will\s+and\s+testament|letters?\s+of\s+administration)\b/.test(
        t,
      ) ||
      (/\b(parents?|mum|dad|mother|father)\b/.test(t) &&
        /\b(died|passed\s+away|deceased)\b/.test(t) &&
        /\b(house|home|property|estate|share|claim|sibling|brother|sister|inherit)\b/.test(t)),
  },
  {
    l1: 'employment',
    l2: 'pregnancy_maternity',
    packId: 'pregnancy_redundancy',
    matterType: 'employment',
    frameIds: ['emp-pregnancy', 'emp-unfair', 'emp-tribunal'],
    wikiDomains: ['employment'],
    weight: 0.94,
    reason: 'Pregnancy / maternity with redundancy or dismissal',
    test: (t) =>
      /\b(pregnant|pregnancy|maternity)\b/.test(t) &&
      /\b(redundan|dismiss|sack|employer|retain|job)\b/.test(t),
  },
  {
    l1: 'property',
    l2: 'joint_tenancy',
    packId: 'joint_tenancy_liability',
    matterType: 'housing',
    frameIds: ['hous-joint-liability', 'hous-deposit', 'hous-possession'],
    wikiDomains: ['housing'],
    weight: 0.93,
    reason: 'Joint tenancy / flatmate rent liability',
    test: (t) =>
      /\b(flatmate|housemate|joint\s+tenant|both\s+on\s+the\s+tenancy|jointly\s+liable)\b/.test(t) ||
      (/\b(flatmate|housemate|roommates?)\b/.test(t) && /\b(rent|tenancy|liable|share)\b/.test(t)),
  },
  {
    l1: 'property',
    l2: 'deposit_protection',
    packId: 'deposit_protection',
    matterType: 'housing',
    frameIds: ['hous-deposit', 'hous-possession', 'hous-general'],
    wikiDomains: ['housing'],
    weight: 0.88,
    reason: 'Tenancy deposit scheme',
    test: (t) =>
      /\b(deposit|mydeposits|tds|dps|reposit)\b/.test(t) &&
      /\b(landlord|tenant|tenancy|ast)\b/.test(t) &&
      !/\b(flatmate|housemate|joint\s+tenant)\b/.test(t),
  },
  {
    l1: 'property',
    l2: 'possession_eviction',
    packId: 'possession_eviction',
    matterType: 'housing',
    frameIds: ['hous-possession', 'hous-homeless', 'hous-general'],
    wikiDomains: ['housing'],
    weight: 0.9,
    reason: 'Possession / eviction',
    test: (t) =>
      /\b(section\s*21|section\s*8|evict|possession\s+order|bailiff|lock(?:ed)?\s*out)\b/.test(t) &&
      !/\bmortgage\b/.test(t),
  },
  {
    l1: 'property',
    l2: 'landlord_tenant',
    packId: 'general',
    matterType: 'housing',
    frameIds: ['hous-disrepair', 'hous-general', 'hous-deposit'],
    wikiDomains: ['housing'],
    weight: 0.8,
    reason: 'Landlord–tenant',
    test: (t) =>
      /\b(landlord|tenant|tenancy|disrepair|mould|mold|homeless)\b/.test(t) ||
      (/\brents?\b/.test(t) && !/\bmortgage\b/.test(t)),
  },
  {
    l1: 'employment',
    l2: 'unfair_dismissal',
    packId: 'unfair_dismissal',
    matterType: 'employment',
    frameIds: ['emp-unfair', 'emp-tribunal', 'emp-wages'],
    wikiDomains: ['employment'],
    weight: 0.9,
    reason: 'Dismissal / constructive dismissal',
    test: (t) =>
      /\b(sacked|fired|dismiss|constructive\s+dismissal|unfair\s+dismissal|made\s+redundant|redundan)\b/.test(
        t,
      ) ||
      (/\bmy\s+employer\b/.test(t) && /\b(resign|force|quit|job)\b/.test(t)),
  },
  {
    l1: 'employment',
    l2: 'wages_contract',
    packId: 'unfair_dismissal',
    matterType: 'employment',
    frameIds: ['emp-wages', 'emp-tribunal', 'emp-general'],
    wikiDomains: ['employment'],
    weight: 0.85,
    reason: 'Wages / hours / contract',
    test: (t) =>
      /\b(unpaid\s+overtime|wages|hasn'?t\s+paid\s+my|zero[- ]hours|contractual\s+hours)\b/.test(t) ||
      (/\bemployer\b/.test(t) && /\b(overtime|hours|pay|wage)\b/.test(t)),
  },
  {
    l1: 'immigration',
    l2: 'immigration_status',
    packId: 'general',
    matterType: 'immigration',
    frameIds: ['imm-general', 'imm-challenge'],
    wikiDomains: ['immigration'],
    weight: 0.92,
    reason: 'Immigration / Home Office',
    test: (t) =>
      /\b(ilr|visa|home\s+office|asylum|immigration|settled\s+status|leave\s+to\s+remain|indefinite\s+leave)\b/.test(
        t,
      ),
  },
  {
    l1: 'debt_insolvency',
    l2: 'debt_enforcement',
    packId: 'general',
    matterType: 'debt',
    frameIds: ['debt-enforcement', 'debt-ccj', 'debt-general'],
    wikiDomains: ['debt'],
    weight: 0.82,
    reason: 'Debt enforcement',
    test: (t) => /\b(bailiff|ccj|creditor|debt\s+relief|county\s+court\s+judgment)\b/.test(t),
  },
  {
    l1: 'family',
    l2: 'family_children',
    packId: 'general',
    matterType: 'family',
    frameIds: ['fam-children', 'fam-divorce', 'fam-general'],
    wikiDomains: ['family'],
    weight: 0.84,
    reason: 'Family / children arrangements',
    test: (t) =>
      /\b(divorce|custody|child\s+arrangement|child\s+contact|care\s+order|domestic\s+abuse)\b/.test(t) ||
      (/\b(\d+\s*year\s*old|my\s+(?:son|daughter|kid|child))\b/.test(t) &&
        /\b(my\s+ex|ex[- ]?(?:partner|wife|husband)|his\s+mum|boyfriend'?s\s+kid)\b/.test(t)),
  },
  {
    l1: 'personal_consumer',
    l2: 'consumer_goods',
    packId: 'general',
    matterType: 'consumer',
    frameIds: ['cons-faulty', 'cons-refund', 'cons-general'],
    wikiDomains: ['consumer'],
    weight: 0.8,
    reason: 'Consumer goods / trader',
    test: (t) =>
      /\b(refund|faulty|warranty|trader|garage|dealer|washing\s+machine|not\s+as\s+described)\b/.test(t) ||
      (/\b(car|vehicle)\b/.test(t) && /\b(fault|refund|dealer|garage|broke)\b/.test(t)),
  },
  {
    l1: 'property',
    l2: 'conveyancing',
    packId: 'general',
    matterType: 'conveyancing',
    frameIds: ['conv-purchase', 'conv-compare'],
    wikiDomains: ['housing'],
    weight: 0.86,
    reason: 'Conveyancing',
    test: (t) => /\b(conveyanc|stamp\s+duty|buying\s+a\s+(flat|house)|solicitor.*(buy|sell))\b/.test(t),
  },
  {
    l1: 'crime_public',
    l2: 'criminal_general',
    packId: 'general',
    matterType: 'crime',
    frameIds: ['crime-police', 'crime-general'],
    wikiDomains: ['crime'],
    weight: 0.78,
    reason: 'Criminal / police general',
    test: (t) =>
      /\b(arrest|charg(?:ed|e)\b|magistrates|criminal|offence|cps|assault|theft|fraud)\b/.test(t) &&
      !/\bconfiscat|seiz/.test(t),
  },
]

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
}

/**
 * Heuristic UK taxonomy classifier. Returns best L1/L2 hit or null if weak.
 */
export function classifyUkTaxonomy(text: string): UkTaxonomyHit | null {
  const t = normalize(text || '')
  if (!t.trim()) return null

  let best: Rule | null = null
  const reasons: string[] = []

  for (const rule of RULES) {
    if (!rule.test(t)) continue
    reasons.push(rule.reason)
    if (!best || rule.weight > best.weight) best = rule
  }

  if (!best || best.weight < 0.55) return null

  return {
    l1: best.l1,
    l2: best.l2,
    confidence: best.weight,
    matterType: best.matterType,
    packId: best.packId,
    frameIds: [...best.frameIds],
    wikiDomains: [...best.wikiDomains],
    reasons: reasons.length ? reasons : [best.reason],
  }
}

/** Session-shaped helper: prefer confirmed search query + raw inputs. */
export function classifySessionTaxonomy(parts: Array<string | undefined | null>): UkTaxonomyHit | null {
  return classifyUkTaxonomy(parts.filter(Boolean).join('\n'))
}

/**
 * Optional LLM classifier hook (same shape as heuristic).
 * Callers may replace this later; default reuses heuristics.
 */
export async function classifyUkTaxonomyWithLlm(
  text: string,
  _opts?: { signal?: AbortSignal },
): Promise<UkTaxonomyHit | null> {
  return classifyUkTaxonomy(text)
}

/** Tokens for CAQI / retrieval enrichment. */
export function taxonomyTokens(hit: UkTaxonomyHit | null): string[] {
  if (!hit) return []
  return [
    `tax_l1:${hit.l1}`,
    `tax_l2:${hit.l2}`,
    `pack:${hit.packId}`,
    hit.confidence >= 0.85 ? 'tax_conf:high' : 'tax_conf:mid',
  ]
}
