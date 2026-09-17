/**
 * Stable topic-area key for Exa fallback cache reuse.
 * Similar queries (same legal issue) share one key → one Exa spend.
 */

const STOP = new Set(
  `a an the and or of to in for on with my i we you is are was were be been being
   this that it at from by as if about into over after before about can could would
   should will just so not no yes have has had do does did get got going england
   uk scotland wales britain british someone something anything everything please
   help advice legal question reddit thanks thank hi hello`.split(/\s+/),
)

/** High-signal multi-word topic phrases → canonical keys. */
const TOPIC_PHRASES: Array<{ re: RegExp; key: string }> = [
  { re: /\bpenalty\s+fare\b/i, key: 'penalty-fare' },
  { re: /\bout\s+of\s+sequence\b/i, key: 'airline-out-of-sequence' },
  { re: /\b(unfair\s+terms?|consumer\s+rights\s+act).{0,40}(airline|flight|tos)\b/i, key: 'airline-unfair-terms' },
  { re: /\b(drill\s+track|malicious\s+communications|named.{0,20}threat)/i, key: 'threats-malicious-comms' },
  { re: /\b(stalking|harassment).{0,30}(daughter|child|minor|school)\b/i, key: 'child-harassment-threats' },
  { re: /\b(car\s+rental|hire\s+car).{0,40}(deposit|abroad|section\s*75|chargeback)\b/i, key: 'car-rental-abroad-deposit' },
  { re: /\bsection\s*75\b/i, key: 'section-75-credit-card' },
  { re: /\b(road\s+traffic|hit\s+a\s+parked|duty\s+to\s+stop)\b/i, key: 'rta-duty-to-stop' },
]

export function authorityTopicKey(text: string): string {
  const raw = (text || '').trim()
  if (!raw) return 'unknown'
  for (const { re, key } of TOPIC_PHRASES) {
    if (re.test(raw)) return key
  }
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
  const uniq = [...new Set(tokens)].slice(0, 6)
  if (uniq.length < 2) return uniq[0] || 'unknown'
  return uniq.slice(0, 4).join('-')
}
