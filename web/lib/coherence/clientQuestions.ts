import { storyLooksEmployerSeizedKit } from '@/lib/matter/graphAdmissibility'

/** One Matching Help / brief goal — not a concatenation of every live question. */
export function compressLiveGoal(text: string): string {
  const raw = String(text || '')
  if (storyLooksEmployerSeizedKit(raw)) {
    return 'Recover the work laptop and stop police examining employer files'
  }
  const qs = extractClientQuestions(raw)
  return qs[0] || ''
}

/** Split a story into the questions the client actually asked, plus implied next-step asks. */
export function extractClientQuestions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const raw = String(text || '')

  const push = (q: string) => {
    const cleaned = q.replace(/\s+/g, ' ').trim().replace(/^[:—\-\s]+/, '')
    if (cleaned.length < 12 || cleaned.length > 180) return
    const key = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 72)
    if (!key || seen.has(key)) return
    // Drop a longer question that already contains a shorter one we kept
    for (const existing of out) {
      const a = existing.toLowerCase()
      const b = cleaned.toLowerCase()
      if (a.includes(b.slice(0, 40)) || b.includes(a.slice(0, 40))) return
    }
    seen.add(key)
    out.push(cleaned.endsWith('?') ? cleaned : `${cleaned}?`)
  }

  const chunks = raw.split('?')
  for (let i = 0; i < chunks.length - 1; i++) {
    const piece = chunks[i].replace(/\s+/g, ' ').trim()
    const last = (piece.split(/(?<=[.!])\s+/).pop() || piece)
      .replace(/^(my question:|so,?|and|also)\s+/i, '')
      .trim()
    if (/in a nutshell|member of my staff has been arrested today/i.test(last) && last.length > 80) {
      continue
    }
    push(last)
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
      re: /work laptop|company laptop|employer(?:'s)? (?:work )?laptop|work (?:computer|pc)|belongs to the business/i,
      q: 'Can the work laptop be returned if nobody is charged?',
    },
    {
      re: /open.{0,40}(?:work )?files|look (?:at|through).{0,30}files|access.{0,30}(?:dropbox|files)|right to (?:go into|open)/i,
      q: 'Can police open work files on a seized laptop?',
    },
    {
      re: /how do i get it back|stop them/i,
      q: 'How do I get the work laptop back or stop police examining the files?',
    },
  ]
  for (const item of implied) {
    if (!item.re.test(raw)) continue
    if (item.need && !item.need.test(raw)) continue
    push(item.q)
  }
  return out.slice(0, 5)
}

/**
 * Live questions the Overview body + takeaways still fail to address.
 * Used to accept structured JSON that is shorter than 160 chars but complete,
 * and by the critic without requiring two wiki pages.
 */
export function liveQuestionCoverageGaps(story: string, haystack: string, clientQuestion?: string): string[] {
  const qs = extractClientQuestions(`${clientQuestion || ''}\n${story}`)
  const h = String(haystack || '').toLowerCase()
  const gaps: string[] = []
  for (const q of qs) {
    const returnOfProperty = /laptop|returned|not charged|property/i.test(q)
    const fileExam = /files|examine|dropbox|open work/i.test(q)
    const nextStep = /get it back|stop them|what should i do|next/i.test(q)
    if (returnOfProperty && !/return|property reference|retained as evidence|get .{0,24}back|not charged/i.test(h)) {
      gaps.push('return of property')
    } else if (fileExam && !/files|examine|dropbox|pace|third.?party/i.test(h)) {
      gaps.push('file examination')
    } else if (nextStep && !/write to (?:the )?(?:force|police)|solicitor|property reference|next step/i.test(h)) {
      gaps.push('next step')
    }
  }
  return [...new Set(gaps)]
}
