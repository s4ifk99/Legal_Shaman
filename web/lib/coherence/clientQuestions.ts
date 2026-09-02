/** Split a story into the questions the client actually asked, plus implied next-step asks. */
export function extractClientQuestions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const raw = String(text || '')
  const pieces = raw
    .split(/(?<=[?])/g)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.includes('?') && p.length >= 12 && p.length <= 400)
  for (const p of pieces) {
    const key = p.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  const implied: Array<{ re: RegExp; q: string; need?: RegExp }> = [
    {
      re: /next step|some advice|what (?:can|should) i do/i,
      q: 'What should I do next to stay safe and housed?',
      need: /door|lock|homeless|tenancy|landlord|evict/i,
    },
    { re: /right to stay|no tenancy|tied/i, q: 'Do I have a right to stay without a written tenancy?' },
    {
      re: /door (?:had been )?removed|changed? (?:the )?locks?|leave immediately|forced .{0,40}(?:leave|vacate)|no front door/i,
      q: 'What can I do after being locked out or forced to leave without a court order?',
    },
    { re: /wages|holiday pay/i, q: 'Can wages or holiday pay be withheld until I leave?' },
    {
      re: /nowhere else|homeless|tonight|emergency (?:housing|alternative)|sofa to crash/i,
      q: 'Where can I get emergency housing tonight?',
    },
    {
      re: /work laptop|company laptop|employer(?:'s)? (?:work )?laptop|work (?:computer|pc)/i,
      q: 'Can the work laptop be returned if nobody is charged?',
    },
    {
      re: /open.{0,40}(?:work )?files|look (?:at|through).{0,30}files|access.{0,30}(?:dropbox|files)/i,
      q: 'Can police open work files on a seized laptop?',
    },
  ]
  for (const item of implied) {
    if (!item.re.test(raw)) continue
    if (item.need && !item.need.test(raw)) continue
    const key = item.q.toLowerCase().slice(0, 80)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item.q)
  }
  return out.slice(0, 6)
}
