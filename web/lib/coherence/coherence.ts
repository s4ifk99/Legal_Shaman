/**
 * Phase 3 — local coherence / constraint pass (v1 weighted rules).
 *
 * Sits after Phase 1 frame proposal + Phase 2 wiki retrieve.
 * Scores local fit per frame; returns plural tops + unmet constraints.
 * Fit ≠ truth. Do not collapse to a single global winner.
 */
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import { looksNeighbourDispute, looksVisaRefusalOrChallenge } from './sense'
import { clipPhrase } from './timelineExtract'

/** Lightweight wiki / guidance node for the session graph. */
export interface WikiCandidate {
  id: string
  title: string
  frameIds: string[]
  jurisdiction: string
  contradictions?: string[]
  kind?: string
  score?: number
}

export interface GraphNode {
  id: string
  kind: 'fact' | 'goal' | 'flag' | 'frame' | 'doc'
  label: string
}

export interface GraphEdge {
  from: string
  to: string
  polarity: '+' | '-'
  weight: number
  reason: string
}

export interface FrameFit {
  frameId: string
  /** Local fit 0–100 (engineering term — not truth). */
  fitScore: number
  supports: string[]
  conflicts: string[]
  unmetConstraints: string[]
  openQuestions: string[]
}

export interface CoherencePassResult {
  /** Re-ranked frames (plural tops), scores = local fit. */
  frames: LegalFrame[]
  fits: FrameFit[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  conflictsDetected: { description: string; resolution: 'unresolved'; note: string }[]
  clarifierSuggestions: { id: string; text: string; reason: string }[]
}

function corpus(session: SessionState): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => `${e.label} ${e.rawSpan ?? ''}`),
    ...session.parties.map((p) => `${p.label} ${p.role ?? ''}`),
    ...session.documents,
    ...session.softFlags,
  ]
    .join(' ')
    .toLowerCase()
}

function clip(text: string, max = 72): string {
  return clipPhrase(text, max)
}

/** Soft mutual exclusions — negative edges between frames, not hard bans. */
const FRAME_TENSIONS: [string, string, string][] = [
  ['imm-asylum', 'imm-settlement', 'Asylum / protection vs settlement-as-primary can pull apart'],
  ['imm-asylum', 'imm-adviser', 'Protection urgency vs directory-only framing'],
  ['imm-challenge', 'imm-adviser', 'Challenge pathway vs find-adviser-only'],
  ['imm-return', 'imm-settlement', 'Removal history vs settlement-as-primary'],
]

type UnmetRule = {
  id: string
  label: string
  question: string
  applies: (frameId: string, session: SessionState, text: string) => boolean
  filled: (session: SessionState, text: string) => boolean
}

const UNMET_RULES: UnmetRule[] = [
  {
    id: 'constraint_jurisdiction',
    label: 'UK nation not confirmed',
    question: 'Is this in England & Wales, Scotland, or Northern Ireland?',
    applies: () => true,
    filled: (s) => s.jurisdiction !== 'Unknown',
  },
  {
    id: 'constraint_goal',
    label: 'Desired outcome not stated',
    question: 'What would a good outcome look like for you?',
    applies: () => true,
    filled: (s) => Boolean(s.goal.trim()),
  },
  {
    id: 'constraint_timeline_thin',
    label: 'Timeline still thin',
    question: 'What happened next — can you add the key steps in order?',
    applies: () => true,
    filled: (s) => s.events.length >= 2 || s.whatHappened.trim().length >= 40,
  },
  {
    id: 'constraint_decision_date',
    label: 'Decision / refusal date unclear',
    question: 'When did you get the refusal or decision, roughly?',
    applies: (fid, _s, t) =>
      fid === 'imm-challenge' || (fid.startsWith('imm-') && looksVisaRefusalOrChallenge(t)),
    filled: (_s, t) =>
      /\b(20\d{2}|last month|this year|yesterday|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(
        t,
      ),
  },
  {
    id: 'constraint_decision_letter',
    label: 'Decision letter / notice not named',
    question: 'Do you still have the refusal letter or decision notice?',
    applies: (fid, _s, t) => fid === 'imm-challenge' || looksVisaRefusalOrChallenge(t),
    filled: (s, t) => s.documents.length > 0 || /letter|notice|decision|refusal letter/.test(t),
  },
  {
    id: 'constraint_leave_status',
    label: 'Current leave / time in UK unclear',
    question: 'What leave do you have now, and roughly how long have you been in the UK?',
    applies: (fid) => fid === 'imm-settlement',
    filled: (_s, t) =>
      /\bilr\b|indefinite|settled|leave to remain|visa|years? in (the )?uk|lived here/.test(t),
  },
  {
    id: 'constraint_family_link',
    label: 'UK family / sponsor link unclear',
    question: 'Who in the UK are you joining or staying with — and what is your relationship?',
    applies: (fid) => fid === 'imm-family',
    filled: (_s, t) => /spouse|partner|husband|wife|child|parent|sponsor|family/.test(t),
  },
  {
    id: 'constraint_protection_basis',
    label: 'Protection basis still thin',
    question: 'What are you afraid would happen if you had to go back?',
    applies: (fid) => fid === 'imm-asylum',
    filled: (_s, t) => /scared|afraid|asylum|refugee|persecut|harm|kill|torture|protect/.test(t),
  },
  {
    id: 'constraint_removal_when',
    label: 'Removal / deportation timing unclear',
    question: 'When were you removed or deported, and where are you now?',
    applies: (fid) => fid === 'imm-return',
    filled: (_s, t) => /\b(20\d{2}|deported|removed)\b/.test(t),
  },
  {
    id: 'constraint_character_detail',
    label: 'Character / suitability allegation unclear',
    question: 'What did the Home Office say about character or suitability?',
    applies: (fid) => fid === 'imm-suitability',
    filled: (_s, t) => /character|suitability|criminal|conviction|offence|offense/.test(t),
  },
  {
    id: 'constraint_housing_notice',
    label: 'Notice / tenancy papers unclear',
    question: 'Do you have a tenancy agreement or any notice from the landlord (for example section 21)?',
    applies: (fid) => fid.startsWith('hous-') && fid !== 'hous-neighbour',
    filled: (s, t) =>
      looksNeighbourDispute(
        [...s.rawInputs, s.whatHappened, s.goal].join(' '),
      ) ||
      s.documents.length > 0 ||
      /tenancy|section\s*21|section\s*8|notice|possession/.test(t),
  },
  {
    id: 'constraint_employment_status',
    label: 'Job / pay details thin',
    question: 'Were you an employee or worker, and roughly how long had you been in the job?',
    applies: (fid) => fid.startsWith('emp-'),
    filled: (_s, t) => /employee|worker|contract|years?|months?|full.?time|part.?time/.test(t),
  },
  {
    id: 'constraint_acas',
    label: 'ACAS / early conciliation not checked',
    question: 'Have you contacted ACAS about early conciliation yet?',
    applies: (fid) => fid === 'emp-tribunal' || fid === 'emp-unfair',
    filled: (_s, t) => /acas|early conciliation|tribunal claim/.test(t),
  },
  {
    id: 'constraint_debt_stage',
    label: 'Debt enforcement stage unclear',
    question: 'What stage is this at — letter, CCJ, bailiff visit, or something else?',
    applies: (fid) => fid.startsWith('debt-'),
    filled: (_s, t) => /letter|ccj|bailiff|judgment|warrant|breathing space|iva/.test(t),
  },
  {
    id: 'constraint_children_detail',
    label: 'Children / arrangements detail thin',
    question: 'How old are the children, and what contact (if any) is happening now?',
    applies: (fid) => fid === 'fam-children',
    filled: (_s, t) => /years? old|contact|weekend|school|arrangement order/.test(t),
  },
  {
    id: 'constraint_safety',
    label: 'Safety / urgent protection unclear',
    question: 'Are you safe right now, and do you need emergency help?',
    applies: (fid, s) => fid === 'fam-domestic' || s.safetyRisk,
    filled: (s, t) =>
      s.safetyRisk === false && /safe|refuge|injunction|non-molestation|999|police/.test(t),
  },
  {
    id: 'constraint_consumer_proof',
    label: 'Purchase / trader proof unclear',
    question: 'Do you still have the receipt, order confirmation, or trader details?',
    applies: (fid) => fid.startsWith('cons-'),
    filled: (s, t) => s.documents.length > 0 || /receipt|order|invoice|email|trader|company/.test(t),
  },
]

function narrativeSupportReasons(frameId: string, text: string): string[] {
  const reasons: string[] = []
  const checks: Record<string, [RegExp, string][]> = {
    'imm-challenge': [
      [/refus|reject|appeal|review|tribunal/, 'Story mentions refusal / review / appeal'],
    ],
    'imm-settlement': [
      [/\bilr\b|indefinite leave|settlement|settled status/, 'Story centres on settlement / ILR'],
    ],
    'imm-asylum': [
      [/asylum|refugee|scared to go back|protect/, 'Story raises protection / fear of return'],
    ],
    'imm-family': [[/family|spouse|partner|child|join/, 'Story involves family / partner route']],
    'imm-return': [[/deport|remov|detain|return/, 'Story includes removal / return history']],
    'imm-suitability': [
      [/character|suitability|criminal|conviction/, 'Client raised character / suitability'],
    ],
    'imm-adviser': [
      [/adviser|solicitor|find|near me|regulated/, 'Immediate need may be finding regulated help'],
    ],
    'imm-general': [[/visa|immigration|home office|leave/, 'General immigration language present']],
    'hous-possession': [[/evict|lock|possession|section\s*21|section\s*8/, 'Possession / eviction language']],
    'hous-disrepair': [[/mould|mold|damp|\brepairs?\b|disrepair/, 'Disrepair / conditions language']],
    'hous-deposit': [[/deposit|\brents?\b|arrears/, 'Rent / deposit language']],
    'hous-homeless': [[/homeless|sofa|nowhere to stay/, 'Homelessness language']],
    'hous-lease-fire': [
      [/fire door|leasehold|tamper|shared (?:property|block)|latch/, 'Leasehold / fire safety language'],
    ],
    'hous-neighbour': [
      [
        /neighbour|neighbor|car\s*port|carport|park(?:ed|ing)|boundary|noise|blocking|right of way|easement|shared (?:drive|access)/,
        'Neighbour / access language',
      ],
    ],
    'hous-general': [
      [/\b(landlord|tenant|tenancy|section\s*21|\brents?\b)\b/, 'Landlord–tenant language present'],
    ],
    'emp-unfair': [[/dismiss|fired|sacked|constructive/, 'Dismissal language']],
    'emp-disability-ra': [
      [
        /bradford|reasonable adjustment|sickness absence|disability[- ]related|absence (?:management|procedure|trigger)|fluctuating/,
        'Disability / absence adjustment language',
      ],
    ],
    'emp-wages': [[/wage|pay|holiday|contract|hours/, 'Pay / contract language']],
    'emp-discrim': [[/discriminat|harass|whistle|disabilit|disabled|equality act/, 'Discrimination / disability language']],
    'emp-tribunal': [[/tribunal|acas|early conciliation/, 'Tribunal / ACAS language']],
    'emp-general': [[/employer|job|work|employment/, 'Employment language present']],
    'debt-enforcement': [[/bailiff|enforcement|warrant/, 'Enforcement / bailiff language']],
    'debt-ccj': [[/ccj|county court|judgment/, 'CCJ / judgment language']],
    'debt-benefits': [
      [/universal credit|\bpip\b|deprivation of capital|benefit/, 'Benefits / UC / PIP language'],
    ],
    'debt-solution': [[/afford|iva|bankruptcy|breathing/, 'Debt solution language']],
    'debt-general': [[/debt|owe|creditor|money/, 'Debt language present']],
    'fam-children': [[/child|custody|contact|arrangement/, 'Children / arrangements language']],
    'fam-divorce': [[/divorce|separat|finances/, 'Divorce / separation language']],
    'fam-domestic': [[/domestic|abuse|injunction|hit me|threat/, 'Domestic abuse / safety language']],
    'fam-general': [[/family|partner|divorce|child/, 'Family language present']],
    'cons-refund': [[/refund|cancel|return|chargeback/, 'Refund / cancellation language']],
    'cons-faulty': [[/faulty|broken|guarantee|warranty|broke down/, 'Faulty goods / services language']],
    'cons-trader': [[/trader|scam|mis-sell|garage|unfair/, 'Trader / unfair practice language']],
    'cons-general': [[/consumer|goods|refund|trader/, 'Consumer language present']],
  }
  for (const [re, reason] of checks[frameId] ?? []) {
    if (re.test(text)) reasons.push(reason)
  }
  return reasons
}

function buildGraph(
  session: SessionState,
  frames: LegalFrame[],
  candidates: WikiCandidate[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const text = corpus(session)

  for (const e of session.events) {
    nodes.push({ id: `fact:${e.id}`, kind: 'fact', label: e.label })
  }
  if (session.whatHappened.trim()) {
    nodes.push({ id: 'fact:what_happened', kind: 'fact', label: clip(session.whatHappened, 80) })
  }
  if (session.goal.trim()) {
    nodes.push({ id: 'goal:stated', kind: 'goal', label: clip(session.goal, 80) })
  }
  for (const f of session.softFlags) {
    nodes.push({ id: `flag:${f}`, kind: 'flag', label: f })
  }
  for (const frame of frames) {
    nodes.push({ id: `frame:${frame.id}`, kind: 'frame', label: frame.label })
  }
  for (const c of candidates) {
    nodes.push({ id: `doc:${c.id}`, kind: 'doc', label: c.title })
  }

  for (const frame of frames) {
    const fid = `frame:${frame.id}`
    for (const reason of narrativeSupportReasons(frame.id, text)) {
      edges.push({
        from: 'fact:what_happened',
        to: fid,
        polarity: '+',
        weight: 1,
        reason,
      })
    }
    if (session.goal.trim()) {
      const g = session.goal.toLowerCase()
      const goalFits =
        (frame.id === 'imm-challenge' && /appeal|review|challeng|refus/.test(g)) ||
        (frame.id === 'imm-settlement' && /ilr|settlement|stay|remain/.test(g)) ||
        (frame.id === 'imm-asylum' && /asylum|protect|safe|stay/.test(g)) ||
        (frame.id === 'imm-family' && /join|family|spouse|partner|child/.test(g)) ||
        (frame.id === 'imm-adviser' && /solicitor|adviser|help|lawyer/.test(g)) ||
        (frame.id === 'imm-return' && /return|come back|re-?enter/.test(g)) ||
        (frame.id.startsWith('hous-') && /stay|home|evict|\brepairs?\b|deposit|landlord|neighbour|neighbor|driveway|parking|stop/.test(g)) ||
        (frame.id.startsWith('emp-') && /job|pay|wage|tribunal|dismiss|reinstate/.test(g)) ||
        (frame.id.startsWith('debt-') && /stop|pay|afford|bailiff|ccj/.test(g)) ||
        (frame.id.startsWith('fam-') && /child|contact|safe|divorce|see the kids/.test(g)) ||
        (frame.id.startsWith('cons-') && /refund|fix|replace|money back/.test(g))
      if (goalFits) {
        edges.push({
          from: 'goal:stated',
          to: fid,
          polarity: '+',
          weight: 1.2,
          reason: 'Stated goal aligns with this frame',
        })
      }
    }
    for (const c of candidates) {
      if (!c.frameIds.includes(frame.id)) continue
      edges.push({
        from: `doc:${c.id}`,
        to: fid,
        polarity: '+',
        weight: c.kind === 'pathway' ? 1.4 : 1,
        reason: `Wiki “${c.title}” supports frame`,
      })
      for (const contra of c.contradictions ?? []) {
        if (!contra.trim()) continue
        edges.push({
          from: `doc:${c.id}`,
          to: fid,
          polarity: '-',
          weight: 0.8,
          reason: `Wiki contradiction flag: ${clip(contra, 60)}`,
        })
      }
    }
  }

  for (const [a, b, reason] of FRAME_TENSIONS) {
    if (frames.some((f) => f.id === a) && frames.some((f) => f.id === b)) {
      edges.push({
        from: `frame:${a}`,
        to: `frame:${b}`,
        polarity: '-',
        weight: 0.5,
        reason,
      })
    }
  }

  return { nodes, edges }
}

function unmetForFrame(frameId: string, session: SessionState, text: string): UnmetRule[] {
  return UNMET_RULES.filter((r) => r.applies(frameId, session, text) && !r.filled(session, text))
}

/**
 * Local maximiser v1: weighted scoring per frame (not a global integrity pass).
 */
export function maximiseLocalCoherence(
  session: SessionState,
  frames: LegalFrame[],
  candidates: WikiCandidate[] = [],
  limit = 3,
): CoherencePassResult {
  const text = corpus(session)
  const { nodes, edges } = buildGraph(session, frames, candidates)
  const fits: FrameFit[] = []

  for (const frame of frames) {
    const fid = `frame:${frame.id}`
    const supportEdges = edges.filter((e) => e.to === fid && e.polarity === '+')
    const conflictEdges = edges.filter(
      (e) => (e.to === fid || e.from === fid) && e.polarity === '-' && e.to.startsWith('frame:'),
    )
    // Doc-level conflicts targeting this frame
    const docConflicts = edges.filter((e) => e.to === fid && e.polarity === '-')

    const proposal = Math.min(100, Math.max(0, frame.score))
    const narrative = Math.min(
      40,
      supportEdges.filter((e) => e.from.startsWith('fact:') || e.from === 'goal:stated').reduce((s, e) => s + e.weight * 12, 0),
    )
    const wiki = Math.min(
      30,
      supportEdges.filter((e) => e.from.startsWith('doc:')).reduce((s, e) => s + e.weight * 8, 0),
    )
    const conflictPenalty = Math.min(
      25,
      [...conflictEdges, ...docConflicts].reduce((s, e) => s + e.weight * 8, 0),
    )

    const unmet = unmetForFrame(frame.id, session, text)
    const unmetPenalty = Math.min(20, unmet.length * 4)

    // Blend: keep proposal signal but let evidence move ranking
    const fitScore = Math.round(
      Math.max(
        0,
        Math.min(100, proposal * 0.35 + narrative + wiki + (candidates.length ? 5 : 0) - conflictPenalty - unmetPenalty),
      ),
    )

    fits.push({
      frameId: frame.id,
      fitScore,
      supports: supportEdges.map((e) => e.reason),
      conflicts: [...conflictEdges, ...docConflicts].map((e) => e.reason),
      unmetConstraints: unmet.map((u) => u.label),
      openQuestions: unmet.map((u) => u.question),
    })
  }

  fits.sort((a, b) => b.fitScore - a.fitScore)
  const topFits = fits.slice(0, limit)

  const ranked: LegalFrame[] = topFits.map((f) => {
    const base = frames.find((x) => x.id === f.frameId)!
    const supportWhy = f.supports[0]
    return {
      ...base,
      score: f.fitScore,
      fitScore: f.fitScore,
      unmetConstraints: f.unmetConstraints,
      why: supportWhy ? `${base.why} Fit: ${supportWhy}.` : base.why,
    }
  })

  const conflictsDetected = edges
    .filter((e) => e.polarity === '-')
    .slice(0, 8)
    .map((e) => ({
      description: e.reason,
      resolution: 'unresolved' as const,
      note: `${e.from} ⊖ ${e.to}`,
    }))

  // Clarifiers: unique unmet from top frames, prefer shared then frame-specific
  const seen = new Set<string>()
  const clarifierSuggestions: CoherencePassResult['clarifierSuggestions'] = []
  for (const f of topFits) {
    for (const rule of unmetForFrame(f.frameId, session, text)) {
      if (seen.has(rule.id)) continue
      if (session.answeredPromptIds.includes(rule.id)) continue
      seen.add(rule.id)
      clarifierSuggestions.push({
        id: rule.id,
        text: rule.question,
        reason: `Unmet for ${f.frameId}: ${rule.label}`,
      })
      if (clarifierSuggestions.length >= 3) break
    }
    if (clarifierSuggestions.length >= 3) break
  }

  return {
    frames: ranked,
    fits: topFits,
    nodes,
    edges,
    conflictsDetected,
    clarifierSuggestions,
  }
}

/** Map wiki hits into candidate nodes. */
export function wikiHitsToCandidates(
  hits: { id: string; title: string; frameIds: string[]; jurisdiction: string; contradictions?: string[]; kind?: string; score?: number }[],
): WikiCandidate[] {
  return hits.map((h) => ({
    id: h.id,
    title: h.title,
    frameIds: h.frameIds,
    jurisdiction: h.jurisdiction,
    contradictions: h.contradictions,
    kind: h.kind,
    score: h.score,
  }))
}

export function fitForFrame(result: CoherencePassResult, frameId: string): FrameFit | undefined {
  return result.fits.find((f) => f.frameId === frameId)
}

/**
 * Next constraint clarifier for the question loop (≤3 total suggestions in pass;
 * one at a time here).
 */
export function nextConstraintClarifier(
  session: SessionState,
  pass: CoherencePassResult,
): { id: string; text: string; reason: string } | null {
  for (const c of pass.clarifierSuggestions) {
    if (!session.answeredPromptIds.includes(c.id)) return c
  }
  return null
}
