import type { TimelineEvent } from './types'

const uid = () => Math.random().toString(36).slice(2, 10)

export type ExtractedEvent = {
  label: string
  rawSpan: string
  dateApprox?: string
}

/** Domain-agnostic story beats → short timeline labels. */
const EVENT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bilr\b.*appl(y|ied)|appl(y|ied).*\bilr\b/i, label: 'Applied for ILR' },
  { re: /\bilr\b.*(reject|refus)|(reject|refus).*\bilr\b/i, label: 'ILR application refused' },
  { re: /\bdeport/i, label: 'Deportation issue raised' },
  { re: /asylum.*(refus|reject)|(refus|reject).*asylum/i, label: 'Asylum claim refused' },
  { re: /accident at work|workplace accident|injured at work/i, label: 'Workplace accident' },
  { re: /\b(slipped|fell|injured)\b/i, label: 'Injury / accident' },
  { re: /lock(?:ed)?(?:\s+\w+){0,2}\s*out/i, label: 'Locked out of property' },
  { re: /mould|mold/i, label: 'Complained about mould / disrepair' },
  { re: /\bevict/i, label: 'Eviction issue raised' },
  { re: /section\s*21/i, label: 'Section 21 notice' },
  { re: /fired|dismiss|sacked/i, label: 'Dismissal / job loss' },
  { re: /unpaid wages|hasn'?t paid|wage.*not paid/i, label: 'Unpaid wages raised' },
  { re: /\bbought\b.*\b(car|vehicle)\b|\bpurchased\b.*\b(car|vehicle)\b/i, label: 'Purchased vehicle' },
  { re: /board computer|\becu\b|electrical fault/i, label: 'Electrical / board computer fault' },
  {
    re: /still (?:broken|faulty|not fixed|not working)|didn'?t fix|not been fixed|hasn'?t been fixed|came back|returned after/i,
    label: 'Fault persisted after repair',
  },
  {
    re: /took (?:it|the car|the vehicle) back|went back to (?:the )?(?:mechanic|garage|dealer)|back to (?:the )?(?:mechanic|garage|dealer)/i,
    label: 'Returned vehicle to trader',
  },
  {
    re: /fault codes?|battery died|battery.*fault|broke down|not as described|discovered faults?|found faults?/i,
    label: 'Vehicle fault reported',
  },
  { re: /replaced.*battery|rectif|repaired|fixed.*car/i, label: 'Repair or replacement attempted' },
  {
    re: /refus(?:e|ed|es|ing).*(?:fix|repair|refund|remedy)|won'?t (?:fix|repair|refund)|(?:fix|repair|refund).*(?:refus|reject)/i,
    label: 'Trader refused remedy',
  },
  { re: /reject(?:ing|ed) the (?:car|vehicle)|seeking a refund|sought a refund/i, label: 'Rejected goods / sought refund' },
  { re: /independent (?:auto )?electrician|independent (?:report|inspection|scan)/i, label: 'Independent inspection obtained' },
  { re: /court money claim|issued a (?:court )?claim|money claim online/i, label: 'Court claim issued' },
  { re: /passed it to their legal team|legal rep|legal team/i, label: 'Referred to legal team' },
  {
    re: /doesn'?t count as their one opportunity|one opportunity to repair|charged me for the battery/i,
    label: 'CRA repair-opportunity dispute',
  },
  { re: /misunderstanding/i, label: 'Dealer claimed a misunderstanding' },
  { re: /paid for (?:the )?(?:battery|repair|part)/i, label: 'Paid for repair / parts' },
  { re: /complain|wrote (to|a letter)|sent a letter|template letter/i, label: 'Complaint raised' },
  { re: /warrant|guarantee/i, label: 'Warranty / guarantee raised' },
  { re: /bailiff|enforcement agent/i, label: 'Bailiff / enforcement contact' },
  { re: /ccj|county court judgment/i, label: 'CCJ / court judgment' },
  { re: /bad character|criminal record|conviction/i, label: 'Character / suitability concern raised' },
  { re: /domestic abuse|hit me|threaten/i, label: 'Domestic abuse / safety concern' },
  { re: /deposit.*not return|withheld.*deposit/i, label: 'Deposit dispute' },
  { re: /notice to quit|notice period/i, label: 'Notice given' },
]

const MONTH_DATE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s*((?:19|20)\d{2}))?\b/i

const DURATION =
  /\b(?:after|within|about|around|some)?\s?\d+\s+(?:day|week|month|year)s?\b(?:\s+(?:later|ago|after|on))?/i

function extractDate(chunk: string): string | undefined {
  const month = chunk.match(MONTH_DATE)?.[0]
  if (month) return month
  const year = chunk.match(/\b((?:19|20)\d{2})\b/)?.[0]
  if (year) return year
  const relative = chunk.match(
    /\b(last week|yesterday|today|last month|this year|two weeks ago|few weeks ago|last year|recently|earlier this year)\b/i,
  )?.[0]
  if (relative) return relative
  return chunk.match(DURATION)?.[0]?.trim()
}

const LABEL_MAX = 78
const LABEL_MIN = 24
/** Beats at least this long keep the client's wording instead of a generic canned label. */
const DETAILED_BEAT_MIN = 55

const BEAT_SPLIT_RE =
  /(?<=[.!?])\s+(?=[A-Z"'(£])|[;]\s+|¶|\s+[,]?\s*and then\s+|\s+then\s+|\s+after that\s+|\s+later[,]?\s+|\s+subsequently\s+|\s+a few (?:days|weeks|months) later\s+|\s+two weeks later\s+|\s+the next day\s+|\s+next day\s+|\s+anyway[,]?\s+|\s+so again\s+|\s+at this point\s+|\s+lo and behold[,]?\s+|\s+rang the dealer\s+/i

/** Sentence openers that carry no meaning in a timeline label. */
const LEADING_FILLER =
  /^(?:so|and|but|then|also|anyway|well|basically|actually|however|now|firstly|first|next|after that|at the time|long story short|to be honest|obviously|essentially)\b[,\s]+/i

/** Words that must not end a label — they signal an unfinished clause. */
const DANGLING = new Set([
  'and', 'but', 'so', 'or', 'nor', 'yet', 'the', 'a', 'an', 'to', 'of', 'for', 'with', 'that',
  'which', 'who', 'whom', 'if', 'we', 'they', 'he', 'she', 'it', 'i', 'you', 'was', 'were', 'is',
  'are', 'be', 'been', 'being', 'had', 'has', 'have', 'did', 'do', 'does', 'on', 'in', 'at', 'by',
  'from', 'as', 'after', 'before', 'when', 'while', 'because', 'since', 'about', 'our', 'their',
  'his', 'her', 'my', 'this', 'these', 'those', 'there', 'said', 'told', 'up', 'out', 'off', 'into',
  'over', 'than', 'then', 'still', 'also', 'very', 'just', 'not', 'no',
])

/** Clause boundaries where a label can end and still read as a finished thought. */
const STRONG_BREAK =
  /,\s|;\s|\s—\s|\s–\s|\s\b(?:and|but|so|because|which|who|that|after|when|while|since|though|although|if|unless|until)\b\s/gi

/** Weaker breaks, used only when no strong boundary produces a clean label. */
const WEAK_BREAK = /\s\b(?:to|for|about|with|from)\b\s/gi

function breakPoints(window: string, re: RegExp, min: number): number[] {
  const points: number[] = []
  re.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(window)) !== null) {
    if (match.index >= min) points.push(match.index)
  }
  return points
}

function stripDangling(value: string): string {
  let out = value.trim().replace(/[\s,;:—–-]+$/, '')
  for (;;) {
    const match = out.match(/\s([A-Za-z']+)$/)
    if (!match || match.index === undefined) break
    if (!DANGLING.has(match[1].toLowerCase())) break
    out = out.slice(0, match.index).trim().replace(/[\s,;:—–-]+$/, '')
  }
  return out
}

function capitalise(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

/** Shorten to `max` by ending on a clause boundary, never mid-thought. */
function cutToClause(text: string, max: number, min: number): string {
  if (text.length <= max) return text

  const window = text.slice(0, max + 1)
  const candidates = [
    ...breakPoints(window, STRONG_BREAK, min).reverse(),
    ...breakPoints(window, WEAK_BREAK, min).reverse(),
  ]

  // Latest strong break first, then weaker ones. A cut is only accepted when it needs
  // no dangling-word trimming, which means it lands on a genuine clause end.
  for (const index of candidates) {
    const candidate = text.slice(0, index).trim().replace(/[\s,;:—–-]+$/, '')
    if (candidate.length < min) continue
    if (stripDangling(candidate) === candidate) return candidate
  }

  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = stripDangling(lastSpace > min ? cut.slice(0, lastSpace) : cut)
  return trimmed || text.slice(0, max).trim()
}

/**
 * Condense a narrative beat into a self-contained timeline label.
 * Cuts at clause boundaries so labels read as finished thoughts rather than trailing off.
 */
export function summariseToLabel(input: string, max = LABEL_MAX): string {
  let text = input.replace(/\s+/g, ' ').trim().replace(/^[,.\s]+/, '')
  for (let i = 0; i < 3; i += 1) {
    const stripped = text.replace(LEADING_FILLER, '').trim()
    if (stripped === text) break
    text = stripped
  }
  text = text.replace(/[.!?]+$/, '').trim()
  if (!text) return ''
  return capitalise(cutToClause(text, max, LABEL_MIN))
}

/**
 * Shorten a phrase quoted back to the client, keeping their wording but ending on a
 * clause boundary instead of a trailing ellipsis.
 */
export function clipPhrase(input: string, max = 72): string {
  const text = input.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
  if (!text) return ''
  return cutToClause(text, max, Math.min(20, Math.floor(max / 2)))
}

/**
 * Trim a quoted source sentence to a readable length and close it with a full stop,
 * so cited bullets never trail off mid-clause.
 */
export function tidySentence(input: string, max = 220): string {
  const text = input
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,.\s]+/, '')
    .replace(/[.!?]+$/, '')
    .trim()
  if (!text) return ''
  const out = capitalise(cutToClause(text, max, Math.min(60, Math.floor(max / 2))))
  return /[.!?]$/.test(out) ? out : `${out}.`
}

/** Split a long narrative into story beats (sentences / temporal clauses). */
export function splitNarrativeBeats(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n\s*\n+/g, ' ¶ ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return []

  const multiSentence = /[.!?].+[.!?]/.test(normalized)
  if (normalized.length < 100 && !multiSentence) return [normalized]

  const parts = normalized
    .split(BEAT_SPLIT_RE)
    .map((s) => s.trim().replace(/^[,.\s]+|[,.\s]+$/g, ''))
    .filter((s) => s.length >= 16)

  if (parts.length >= 2) return parts
  return [normalized]
}

/** Forum-style openers and closing questions are not timeline events. */
function isNoiseBeat(beat: string): boolean {
  const trimmed = beat.trim()
  const lower = trimmed.toLowerCase()
  if (
    /^(?:advice needed|i'?ll try to keep|would really appreciate|thanks\.?$)/i.test(trimmed) ||
    /^(?:has anyone been|do they have any legal grounds)/i.test(trimmed)
  ) {
    return true
  }
  if (/\?$/.test(trimmed) && /(?:has anyone|do they have|legal grounds|advice on this)/i.test(lower)) {
    return true
  }
  if (/similar position|paint the full picture/i.test(lower) && trimmed.length < 140) return true
  return false
}

function labelBeat(beat: string): string {
  const summarized = summariseToLabel(beat)
  if (beat.length >= DETAILED_BEAT_MIN && summarized.length >= LABEL_MIN) return summarized
  for (const { re, label } of EVENT_PATTERNS) {
    if (re.test(beat)) return label
  }
  return summarized
}

function isDuplicate(existing: TimelineEvent[], candidate: ExtractedEvent): boolean {
  const span = (candidate.rawSpan || '').toLowerCase().trim()
  if (!span) {
    return existing.some((e) => e.label.toLowerCase() === candidate.label.toLowerCase())
  }
  return existing.some((e) => {
    const exSpan = (e.rawSpan || '').toLowerCase().trim()
    if (!exSpan) return false
    if (span.slice(0, 44) === exSpan.slice(0, 44)) return true
    if (span.length > 28 && exSpan.includes(span.slice(0, 28))) return true
    if (exSpan.length > 28 && span.includes(exSpan.slice(0, 28))) return true
    return false
  })
}

/** Pull multiple timeline events from a free-text story. */
export function extractNarrativeEvents(text: string): ExtractedEvent[] {
  const beats = splitNarrativeBeats(text)
  const results: ExtractedEvent[] = []

  for (const beat of beats) {
    if (isNoiseBeat(beat)) continue
    const label = labelBeat(beat)
    if (!label) continue
    results.push({
      label,
      rawSpan: beat,
      dateApprox: extractDate(beat),
    })
  }

  return results
}

/** Merge extracted beats into an existing timeline without duplicates. */
export function mergeTimelineEvents(
  existing: TimelineEvent[],
  extracted: ExtractedEvent[],
): TimelineEvent[] {
  const out = [...existing]
  for (const e of extracted) {
    if (isDuplicate(out, e)) continue
    out.push({ id: uid(), kind: 'event', label: e.label, rawSpan: e.rawSpan, dateApprox: e.dateApprox })
  }
  return out
}

/** True when text looks like a multi-beat narrative worth splitting. */
export function looksLikeMultiBeatNarrative(text: string): boolean {
  const t = text.trim()
  if (t.length < 80) return false
  if (/[.!?].+[.!?]/.test(t)) return true
  if (/\b(then|after that|later|subsequently|next day|two weeks)\b/i.test(t)) return true
  return splitNarrativeBeats(t).length >= 2
}
