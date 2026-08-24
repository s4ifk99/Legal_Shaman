/**
 * Deterministic pre-reformulation minor / vulnerable gate (T1).
 * Outcomes: allow | clarify_age | refuse_escalate
 * Literature: MinorBench + Safe-Child-LLM graded refusal.
 */

export type MinorGateOutcome = 'allow' | 'clarify_age' | 'refuse_escalate'

export interface MinorGateAssessment {
  outcome: MinorGateOutcome
  matched: string[]
  reasons: string[]
  refuseReason?: string
  escalateHint?: string
  clarifyPrompt?: string
}

const REFUSE_REASON =
  'You appear to be under 18. This tool is for adults seeking regulated help pathways — we should not run automatic legal search for minors.'

const ESCALATE_HINT =
  'Speak to a trusted adult, Childline (0800 1111), or a regulated adviser who works with young people. If you are in immediate danger, call 999.'

const CLARIFY_PROMPT =
  'Before we search: are you under 18, or is this about someone under 18 while you are an adult?'

/** Strip curly quotes; keep original for display elsewhere. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
}

function pushMatch(matched: string[], reasons: string[], label: string, reason: string) {
  if (!matched.includes(label)) matched.push(label)
  if (!reasons.includes(reason)) reasons.push(reason)
}

/** Clear guardian voice talking about their child — not the child as asker. */
function isClearParentVoice(t: string): boolean {
  // "my child trust fund" / "child benefit" are not parent-of-minor voice
  const withoutLegalChildPhrases = t
    .replace(/\bchild\s+trust\s+fund\b/g, ' ')
    .replace(/\bchild\s+benefit\b/g, ' ')
    .replace(/\bchild\s+arrangements?\b/g, ' ')
    .replace(/\bchild\s+maintenance\b/g, ' ')
    .replace(/\bchildren\s+act\b/g, ' ')

  if (
    /\b(my|our)\s+(son|daughter|stepson|stepdaughter|child|kid|children|kids|nephew|niece|grandchild)\b/.test(
      withoutLegalChildPhrases,
    )
  ) {
    return true
  }
  if (/\b(my|our)\s+\d{1,2}\s*[- ]?year[- ]?olds?\b/.test(t)) return true
  if (
    /\b(son|daughter|child|kid)\s+(is|who'?s|aged|who\s+is)\s*(only\s*)?(1[0-7]|under\s*18)\b/.test(
      withoutLegalChildPhrases,
    )
  ) {
    return true
  }
  if (/\bi'?m\s+(a|the)\s+(parent|mum|mom|dad|father|mother|guardian|carer)\b/.test(t)) return true
  if (/\bhelping\s+(my|our)\s+(son|daughter|child|nephew|niece)\b/.test(withoutLegalChildPhrases)) {
    return true
  }
  return false
}

/** Strong evidence the asker is under 18. */
function detectSelfMinor(text: string, t: string, matched: string[], reasons: string[]): boolean {
  let hit = false

  // Reddit-style age/sex tags: 17M, 16f (not 17th, £17, section 17)
  if (/(?:^|[\s\-–—,\/(])(1[0-7])\s*[mf]\b/i.test(text)) {
    pushMatch(matched, reasons, 'reddit_age_tag', 'Age/sex forum tag (e.g. 17M)')
    hit = true
  }

  if (/\b(i'?m|i am|im)\s+(only\s+)?(1[0-7]|under\s*18)\b/.test(t)) {
    pushMatch(matched, reasons, 'im_age', 'First-person age under 18')
    hit = true
  }

  if (/\b(i'?m|i am|im)\s+(a\s+)?(minor|teenager|teen)\b/.test(t)) {
    pushMatch(matched, reasons, 'im_minor', 'Self-identified as minor/teen')
    hit = true
  }

  if (/\bi\s+(am|'m)\s+under\s*(the\s+age\s+of\s*)?18\b/.test(t)) {
    pushMatch(matched, reasons, 'under_18_self', 'Self-declared under 18')
    hit = true
  }

  if (/\b(i'?m|i am|im)\s+(turning|turned)\s+(1[0-7])\b/.test(t)) {
    pushMatch(matched, reasons, 'turning_age', 'Turning/turned under-18 age')
    hit = true
  }

  if (/\bi\b.{0,48}\b(1[0-7])\s*(years?\s*old|y\/?o|yo)\b/.test(t)) {
    pushMatch(matched, reasons, 'i_years_old', 'I … N years old (N<18)')
    hit = true
  }

  if (/\b(1[0-7])\s*(years?\s*old|y\/?o|yo)\b.{0,48}\bi\b/.test(t)) {
    pushMatch(matched, reasons, 'years_old_i', 'N years old … I')
    hit = true
  }

  if (/\b(i'?m|i am|im)\s+in\s+(year|yr\.?)\s*(8|9|10|11|12|13)\b/.test(t)) {
    pushMatch(matched, reasons, 'school_year', 'School year self-ID')
    hit = true
  }

  if (/\b(i'?m|i am|im)\s+(still\s+)?(at\s+school|in\s+sixth\s+form|doing\s+(my\s+)?gcses?)\b/.test(t)) {
    pushMatch(matched, reasons, 'school_status', 'Still in school / GCSEs')
    hit = true
  }

  if (/\bage[d]?\s*:?\s*(1[0-7]|under\s*18)\b/.test(t) && /\b(i|my|me)\b/.test(t)) {
    // Avoid "retirement age: 66" style — only when first-person nearby and age < 18
    if (!/\b(retirement|pension|state\s+pension|driving)\s+age\b/.test(t)) {
      pushMatch(matched, reasons, 'age_field', 'Age field under 18 with first person')
      hit = true
    }
  }

  return hit
}

/** Ambiguous: under-18 topic without clear asker age / parent voice. */
function detectAmbiguous(t: string, matched: string[], reasons: string[]): boolean {
  let hit = false

  if (/\b(under\s*18|underage|u18)\b/.test(t) && /\b(i|my|me|can\s+i)\b/.test(t)) {
    pushMatch(matched, reasons, 'under_18_topic', 'Under-18 topic with first person')
    hit = true
  }

  // "can a 16 year old…" — asker may be that person
  if (/\b(can|could|should)\s+a\s+(1[0-7])\s*(year[- ]?old|y\/?o)?\b/.test(t)) {
    pushMatch(matched, reasons, 'can_n_year_old', 'Hypothetical under-18 rights question')
    hit = true
  }

  // CTF / junior ISA held for the asker, parents controlling — often teen without tag
  if (
    /\b(my\s+)?(child\s+trust\s+fund|ctf|junior\s+isa)\b/.test(t) &&
    /\b(parent|parents|mum|mom|dad)\b/.test(t) &&
    /\b(my|mine|me)\b/.test(t)
  ) {
    pushMatch(matched, reasons, 'ctf_parent_conflict', 'My CTF/JISA vs parents — age unclear')
    hit = true
  }

  // Immigration / housing with a child on the case but unclear who is seeking help
  if (
    /\b(child|son|daughter|kids?|minor)\b/.test(t) &&
    /\b(i|we|our|my)\b/.test(t) &&
    /\b(visa|asylum|deport|home\s+office|ilr|evict|homeless|housing|tenancy)\b/.test(t) &&
    !/\bi'?m\s+(a|the)\s+(parent|mum|mom|dad|guardian|carer)\b/.test(t) &&
    !/\b(my|our)\s+(son|daughter|stepson|stepdaughter)\b/.test(t)
  ) {
    pushMatch(matched, reasons, 'family_immigration_housing', 'Family matter — asker age ambiguous')
    hit = true
  }

  return hit
}

/**
 * Assess whether the lay text indicates a minor asker.
 * Prefer over-refuse on clear self-ID; clarify on ambiguity; allow clear adult/parent voice.
 */
export function assessMinorGate(text: string): MinorGateAssessment {
  const raw = (text || '').trim()
  if (!raw) {
    return { outcome: 'allow', matched: [], reasons: [] }
  }

  const t = normalize(raw)
  const matched: string[] = []
  const reasons: string[] = []

  const parentVoice = isClearParentVoice(t)
  const selfMinor = detectSelfMinor(raw, t, matched, reasons)

  // Self-ID always wins — a 17M saying "my parents" is still a minor asker
  if (selfMinor) {
    return {
      outcome: 'refuse_escalate',
      matched,
      reasons,
      refuseReason: REFUSE_REASON,
      escalateHint: ESCALATE_HINT,
    }
  }

  if (parentVoice) {
    return { outcome: 'allow', matched: ['parent_voice'], reasons: ['Clear adult/guardian voice'] }
  }

  if (detectAmbiguous(t, matched, reasons)) {
    return {
      outcome: 'clarify_age',
      matched,
      reasons,
      clarifyPrompt: CLARIFY_PROMPT,
    }
  }

  return { outcome: 'allow', matched: [], reasons: [] }
}

/** Join the session fields the gate should see. */
export function minorGateTextFromParts(parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Safe-Child-LLM-style graded quality 0–5 for a gate decision vs expected label.
 * 5 = correct hard outcome; 3 = clarify when refuse expected; 0 = allow when refuse expected.
 */
export function scoreRefusalQuality(
  actual: MinorGateOutcome,
  expected: MinorGateOutcome,
): number {
  if (expected === 'refuse_escalate') {
    if (actual === 'refuse_escalate') return 5
    if (actual === 'clarify_age') return 3
    return 0
  }
  if (expected === 'clarify_age') {
    if (actual === 'clarify_age') return 5
    if (actual === 'refuse_escalate') return 4
    return 0
  }
  // expected allow
  if (actual === 'allow') return 5
  if (actual === 'clarify_age') return 2
  return 0
}

export function isHardRefuse(assessment: MinorGateAssessment): boolean {
  return assessment.outcome === 'refuse_escalate'
}
