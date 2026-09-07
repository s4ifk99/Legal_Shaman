import { storyLooksEmployerSeizedKit } from '@/lib/matter/graphAdmissibility'
import { looksPolicePursuitVehicleClaim } from '@/lib/legal/query-signals'

/** Operative dispute themes derived from the client's live ask — not the full narrative. */
export type LiveAskTheme =
  | 'solicitor_ombudsman'
  | 'sra_conduct'
  | 'solicitor_costs'
  | 'employment_wages'
  | 'employment_rights'
  | 'housing_lockout'
  | 'housing_homeless'
  | 'housing_tenancy'
  | 'criminal_police'
  | 'seized_property'
  | 'police_vehicle_claim'

export type LiveAsk = {
  questions: string[]
  goal: string
  themes: LiveAskTheme[]
  /** True when the live dispute is about the client's solicitors / LeO / SRA / fees. */
  solicitorConduct: boolean
  /** True when the live dispute is a claim after police damaged a parked vehicle. */
  policeVehicleClaim: boolean
}

export { looksPolicePursuitVehicleClaim as storyLooksPolicePursuitVehicleClaim }

/**
 * Live ask is about the client's solicitors / LeO / SRA / fees — not the
 * underlying employment dispute. Incidental "holiday pay" must not become the ask.
 */
export function storyLooksSolicitorConductComplaint(story: string): boolean {
  const s = story || ''
  const firmConduct =
    /\b(legal ombudsman|\bleo\b|solicitors?\s+regulation\s+authority|\bsra\b|complain(?:t|ing|ed)?\s+(?:about\s+)?(?:my\s+)?(?:solicitor|law\s+firm|legal\s+adviser)|trainee\s+solicitor|without\s+prejudice\s+letter|success\s+fee|conditional\s+fee|\bcfa\b|stage\s+two\s+complaint|supervision\s+records?|subject\s+access\s+request)\b/i.test(
      s,
    )
  if (!firmConduct) return false
  const askingAboutFirm =
    /\b(legal ombudsman|\bleo\b|\bsra\b|refund(?:s)?\s+of\s+fees|recover(?:ed|ing)?\s+fees|strongest\s+limb|report(?:ing)?\s+to\s+the\s+sra|complain(?:t|ing)\s+(?:about|to)|invoice\s+remained\s+payable|bot[- ]?like|posing\s+as\s+[“"]?clients)\b/i.test(
      s,
    )
  return (
    askingAboutFirm ||
    (firmConduct && /\b(my\s+(?:solicitor|firm)|the\s+firm\s+(?:sent|charged|advised))\b/i.test(s))
  )
}

function themesFromAskBlob(blob: string): LiveAskTheme[] {
  const themes: LiveAskTheme[] = []
  const push = (t: LiveAskTheme) => {
    if (!themes.includes(t)) themes.push(t)
  }
  if (
    /\b(legal ombudsman|\bleo\b|complain(?:t|ing)?\s+(?:about\s+)?(?:a\s+)?(?:legal adviser|solicitor)|refund(?:s)?\s+of\s+fees|fee refund)\b/i.test(
      blob,
    )
  ) {
    push('solicitor_ombudsman')
  }
  if (
    /\b(\bsra\b|solicitors?\s+regulation|report(?:ing)?\s+(?:to\s+)?(?:the\s+)?sra|supervision|trainee\s+solicitor|fake reviews|integrity)\b/i.test(
      blob,
    )
  ) {
    push('sra_conduct')
  }
  if (/\b(success\s+fee|conditional\s+fee|\bcfa\b|solicitor\s+(?:bill|invoice|fees|costs)|costs complaint)\b/i.test(blob)) {
    push('solicitor_costs')
  }
  if (
    /\b(wages?|holiday pay|ssp|statutory sick|last pay|withheld until|getting paid when you leave)\b/i.test(blob)
  ) {
    push('employment_wages')
  }
  if (
    /\b(unfair dismiss|redundan|employment (?:rights|tribunal)|notice pay|acas|discrimination at work)\b/i.test(
      blob,
    )
  ) {
    push('employment_rights')
  }
  if (/\b(lock(?:ed)?\s*out|illegal evict|front door|changed? (?:the )?locks?|forced .{0,40}(?:leave|vacate))\b/i.test(blob)) {
    push('housing_lockout')
  }
  if (/\b(homeless|emergency (?:housing|accommodation)|nowhere to stay|tonight)\b/i.test(blob)) {
    push('housing_homeless')
  }
  if (/\b(tenancy|occup(?:ier|ancy)|right to stay|section\s*21|landlord|tenant)\b/i.test(blob)) {
    push('housing_tenancy')
  }
  if (/\b(police station|arrest|criminal|charged with|duty solicitor)\b/i.test(blob)) {
    push('criminal_police')
  }
  if (/\b(laptop|seized|return of property|work files|dropbox)\b/i.test(blob)) {
    push('seized_property')
  }
  if (
    looksPolicePursuitVehicleClaim(blob) ||
    /\b(claim against (?:the )?police|police (?:car|vehicle).{0,40}(?:hit|damaged)|police claims? (?:process|department))\b/i.test(
      blob,
    )
  ) {
    push('police_vehicle_claim')
  }
  return themes
}

/** One Matching Help / brief goal — not a concatenation of every live question. */
export function compressLiveGoal(text: string): string {
  const raw = String(text || '')
  if (storyLooksEmployerSeizedKit(raw)) {
    return 'Recover the work laptop and stop police examining employer files'
  }
  if (storyLooksSolicitorConductComplaint(raw)) {
    const qs = extractClientQuestions(raw)
    const firmQ = qs.find((q) =>
      /legal ombudsman|\bleo\b|\bsra\b|refund|fee|solicitor|supervision|strongest/i.test(q),
    )
    if (firmQ) return firmQ.replace(/\?$/, '')
    return 'Complain about my solicitors to the Legal Ombudsman / SRA'
  }
  if (looksPolicePursuitVehicleClaim(raw)) {
    return 'Claim against the police for damage to a parked car'
  }
  const qs = extractClientQuestions(raw)
  return qs[0] || ''
}

/** Split a story into the questions the client actually asked, plus implied next-step asks. */
export function extractClientQuestions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const raw = String(text || '')
  const solicitorConduct = storyLooksSolicitorConductComplaint(raw)

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

  const implied: Array<{ re: RegExp; q: string; need?: RegExp; skipIfSolicitor?: boolean }> = [
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
    {
      re: /wages|holiday pay/i,
      q: 'Can wages or holiday pay be withheld until I leave?',
      // Do not invent a wages ask when holiday pay is only solicitor-fee backdrop
      skipIfSolicitor: true,
      need: /withheld|until (?:i |you )?leave|last wages|vacating|upon vacating|getting paid when you leave/i,
    },
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
    if (item.skipIfSolicitor && solicitorConduct) continue
    if (!item.re.test(raw)) continue
    if (item.need && !item.need.test(raw)) continue
    push(item.q)
  }
  if (looksPolicePursuitVehicleClaim(raw)) {
    push('How do I claim against the police for damage to a parked car?')
    push('What evidence should I keep after a police vehicle hit my parked car?')
  }
  return out.slice(0, 5)
}

/**
 * Operative dispute from the client's questions / live goal.
 * Downstream slots and retrieval must prefer this over narrative keywords.
 */
export function liveAskFromStory(story: string, clientQuestion = ''): LiveAsk {
  const combined = `${clientQuestion || ''}\n${story || ''}`.trim()
  const questions = extractClientQuestions(combined)
  const goal = compressLiveGoal(combined)
  const askBlob = [goal, ...questions, clientQuestion].filter(Boolean).join('\n')
  const solicitorConduct = storyLooksSolicitorConductComplaint(combined)
  const policeVehicleClaim = looksPolicePursuitVehicleClaim(combined)
  let themes = themesFromAskBlob(askBlob)

  // When the client asked explicit LeO/SRA/fee questions, those themes win even if
  // narrative keywords also appear in the ask blob.
  if (solicitorConduct) {
    if (!themes.includes('solicitor_ombudsman') && /legal ombudsman|\bleo\b|refund/i.test(askBlob + combined)) {
      themes = ['solicitor_ombudsman', ...themes]
    }
    if (!themes.includes('sra_conduct') && /\bsra\b|supervision|trainee/i.test(askBlob + combined)) {
      themes = [...themes, 'sra_conduct']
    }
    if (!themes.includes('solicitor_costs') && /success fee|conditional fee|\bcfa\b|fees?/i.test(askBlob + combined)) {
      themes = [...themes, 'solicitor_costs']
    }
    // Strip wages/employment-rights themes unless the live ask itself is about withheld pay
    const wagesLive =
      /withheld|until (?:i |you )?leave|last wages|vacating|getting paid when you leave|can wages/i.test(
        askBlob,
      )
    if (!wagesLive) {
      themes = themes.filter((t) => t !== 'employment_wages' && t !== 'employment_rights')
    }
  }

  if (policeVehicleClaim) {
    if (!themes.includes('police_vehicle_claim')) {
      themes = ['police_vehicle_claim', ...themes]
    }
    // Strip criminal-defence arrest themes — asker is the vehicle owner, not the suspect
    if (!/\b(arrest(?:ed)?|charged with|duty solicitor|police station interview)\b/i.test(askBlob)) {
      themes = themes.filter((t) => t !== 'criminal_police')
    }
  }

  // Cafe-flat style: narrative + housing dispute implies wages when pay is withheld until leave
  if (
    !solicitorConduct &&
    !themes.includes('employment_wages') &&
    /wages|holiday pay/i.test(combined) &&
    /withheld|until .{0,20}leave|upon vacating|vacating the property/i.test(combined)
  ) {
    themes.push('employment_wages')
  }

  return {
    questions,
    goal,
    themes: [...new Set(themes)],
    solicitorConduct,
    policeVehicleClaim,
  }
}

export function liveAskHasTheme(ask: LiveAsk, theme: LiveAskTheme): boolean {
  return ask.themes.includes(theme)
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
