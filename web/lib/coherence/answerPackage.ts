/**
 * Policy-aware answer package (AGENTS.md schema) for Overview / Recommendation.
 * Areas/Reference + primary-law spine first; Directory never as primary law; free help before firms.
 */
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import craSpine from '@/data/coherence/primaryLaw/craGoodsRemedies.json'
import { checkAnswerCitations, type CitationIssue } from './citationCheck'
import { buildRetrievalText } from './retrievalText'
import { resolveTopicLock, type LockedPackId, isUsedCarPurchaseStory } from './topicLock'
import { looksNeighbourDispute } from './sense'
import type { OslawCourse } from './wiki'

export type AnswerBullet = {
  text: string
  sourceTitle: string
  sourceUrl: string
  tier: 'areas' | 'reference' | 'primary-law' | 'trusted-guidance' | 'getting-help' | 'law-firm-commentary'
}

export type AnswerWikiLink = {
  title: string
  path: string
  tier: 'areas' | 'reference'
}

export type AnswerFirm = {
  name: string
  directoryUrl: string
  note: string
}

export type AnswerPackage = {
  /** AGENTS.md sections */
  answerOverview: string
  bullets: AnswerBullet[]
  wikiPages: AnswerWikiLink[]
  freeHelp: { title: string; url: string; blurb: string }[]
  recommendedFirms: AnswerFirm[]
  sources: { title: string; url: string; kind: string }[]
  citation: { ok: boolean; issues: CitationIssue[] }
  matchedTopicId: string | null
  policyNote: string
}

function blob(session: SessionState, frames: LegalFrame[]): string {
  return `${buildRetrievalText(session)} ${frames.map((f) => f.id).join(' ')}`.toLowerCase()
}

function isUsedCarReject(text: string, _matter: string): boolean {
  return isUsedCarPurchaseStory(text)
}

export type AnswerPackageOptions = {
  /** When no curated pack matches, lift bullets from OSLAW pathway steps. */
  oslaw?: OslawCourse | null
}

/**
 * Fill thin / unmatched packs from OSLAW steps + official authority hits.
 * Official guidance before firm commentary.
 */
export function enrichAnswerPackageWithOslaw(
  pack: AnswerPackage,
  course: OslawCourse | null | undefined,
  session?: SessionState,
): AnswerPackage {
  if (pack.matchedTopicId) return pack

  const existingFirm = pack.bullets.filter((b) => b.tier === 'law-firm-commentary')
  const bullets: AnswerBullet[] = []
  const sources = [...pack.sources]
  const freeHelp = [...pack.freeHelp]
  const seen = new Set<string>()

  const pushBullet = (b: AnswerBullet) => {
    if (!b.sourceUrl || seen.has(b.sourceUrl)) return
    if (bullets.length >= 4) return
    seen.add(b.sourceUrl)
    bullets.push(b)
    if (!sources.some((s) => s.url === b.sourceUrl)) {
      sources.push({ title: b.sourceTitle, url: b.sourceUrl, kind: b.tier })
    }
  }

  if (course) {
    const overviewBits = [course.title, course.summary].filter(Boolean).join(' — ')
    for (const step of course.steps.slice(0, 4)) {
      const url = step.url || course.primaryUrl
      if (!url) continue
      pushBullet({
        text: (step.detail || step.label).replace(/\s+/g, ' ').trim().slice(0, 280),
        sourceTitle: step.sourceTitle || course.title,
        sourceUrl: url,
        tier: 'trusted-guidance',
      })
    }
    if (course.primaryUrl && !seen.has(course.primaryUrl)) {
      pushBullet({
        text: `Follow the open pathway “${course.title}” for step-by-step guidance on this issue type.`,
        sourceTitle: course.title,
        sourceUrl: course.primaryUrl,
        tier: 'trusted-guidance',
      })
    }
    if (overviewBits && (!pack.answerOverview || /no curated primary-law/i.test(pack.answerOverview))) {
      pack = {
        ...pack,
        answerOverview: `Open wiki pathway matched: ${overviewBits}. The points below are grounded in that pathway’s sources — signposting only, not advice on your specific outcome.`,
      }
    }
  }

  const officialHits = (session?.authorityHits || []).filter(
    (h) => h.kind !== 'law_firm' && h.tier !== 'firm' && h.url,
  )
  for (const h of officialHits.slice(0, 3)) {
    pushBullet({
      text: `Official / trusted guidance: ${h.title.replace(/\s*\|\s*.*$/, '')}. Check how it applies to your facts before you act.`,
      sourceTitle: h.title,
      sourceUrl: h.url,
      tier: 'trusted-guidance',
    })
    if (!freeHelp.some((f) => f.url === h.url)) {
      freeHelp.push({
        title: h.title,
        url: h.url,
        blurb: 'Trusted UK guidance (authority seed / Exa cache).',
      })
    }
  }

  if (bullets.length === 0) {
    pushBullet({
      text: 'Start with Citizens Advice free guidance for your nation, then compare a second official source before you act.',
      sourceTitle: 'Citizens Advice — get advice',
      sourceUrl: 'https://www.citizensadvice.org.uk/get-advice/',
      tier: 'getting-help',
    })
  }

  for (const b of existingFirm) pushBullet(b)

  const next: AnswerPackage = {
    ...pack,
    bullets,
    freeHelp,
    sources,
    citation: { ok: true, issues: [] },
    policyNote:
      pack.policyNote ||
      'Composed from open wiki / authority sources when no curated remedy pack matched. Not legal advice.',
  }
  next.citation = checkAnswerCitations(next)
  return next
}

function pickSections(text: string) {
  const sections = craSpine.sections
  const want30 = /30 day|short-?term|within a month|just bought|few days/.test(text)
  const wantDeduction = /deduct|deduction for use|use of the car|mileage deduction/.test(text)
  const wantRepair = /repair|fault codes?|not fixed|still|failed|came back/.test(text)

  const ids = new Set<string>(['s9', 's19'])
  if (want30) {
    ids.add('s20')
    ids.add('s22')
  }
  if (wantRepair || !want30) {
    ids.add('s23')
    ids.add('s24')
  }
  if (wantDeduction) ids.add('s24')
  // Always include s.24 for car reject after repair stories
  if (wantRepair) ids.add('s24')

  return sections.filter((s) => ids.has(s.id))
}

function isPrivateParkingCharge(text: string): boolean {
  if (looksNeighbourDispute(text)) return false
  if (/\b(neighbour|neighbor|car\s*port|carport|right of way|easement)\b/i.test(text)) {
    return false
  }
  return /\b(parking (?:fine|ticket|charge|app|company)|car\s*park|pcn|popla|private parking|parking on private)\b/i.test(
    text,
  )
}

function isNeighbourAccessDispute(text: string): boolean {
  return looksNeighbourDispute(text)
}

/**
 * Build AGENTS-shaped overview/recommendation for the session.
 * Firms are empty unless a 5+ firm-topic index is wired; free help always first.
 * Topic lock (frames / detectors) wins over keyword bleed.
 */
export function buildAnswerPackage(
  session: SessionState,
  frames: LegalFrame[] = [],
  options: AnswerPackageOptions = {},
): AnswerPackage {
  const text = blob(session, frames)
  const lock = resolveTopicLock(session, frames)
  const lockedPack = lock?.packId as LockedPackId | undefined

  const carCase =
    lockedPack === 'car-reject-failed-repair' ||
    (lockedPack !== 'neighbour-access-dispute' &&
      lockedPack !== 'private-parking-charge' &&
      lockedPack !== 'family-belongings-claim' &&
      isUsedCarReject(text, session.matterType))
  const neighbourCase =
    lockedPack === 'neighbour-access-dispute' ||
    (!carCase && lockedPack !== 'private-parking-charge' && isNeighbourAccessDispute(text))
  const parkingCase =
    lockedPack === 'private-parking-charge' ||
    (!carCase && !neighbourCase && isPrivateParkingCharge(text))

  if (neighbourCase) {
    const caNeighbours = 'https://www.citizensadvice.org.uk/housing/problems-where-you-live/problems-with-neighbours/'
    const govDisputes = 'https://www.gov.uk/how-to-resolve-neighbour-disputes'
    const pack: AnswerPackage = {
      answerOverview:
        'For a neighbour blocking a driveway or building a car port that cuts off access, open guidance usually starts with what rights you have over the land (ownership, shared access, or a right of way), gathering evidence (photos, dates, messages), then informal contact or mediation before court. Planning enforcement may matter if the structure needs permission — that is separate from any civil access claim. This is information and signposting, not advice on your specific outcome.',
      bullets: [
        {
          text: 'Check whether the blocked area is solely yours, shared, or subject to a right of way / easement — that usually shapes what civil options exist.',
          sourceTitle: 'Citizens Advice — problems with neighbours',
          sourceUrl: caNeighbours,
          tier: 'trusted-guidance',
        },
        {
          text: 'GOV.UK outlines practical steps for neighbour disputes, including talking to your neighbour and using mediation before court.',
          sourceTitle: 'GOV.UK — resolving neighbour disputes',
          sourceUrl: govDisputes,
          tier: 'trusted-guidance',
        },
        {
          text: 'Keep a dated record (photos, messages, when access was blocked). If a structure may need planning permission, the council’s planning enforcement route is separate from a private access dispute.',
          sourceTitle: 'Citizens Advice — problems with neighbours',
          sourceUrl: caNeighbours,
          tier: 'trusted-guidance',
        },
      ],
      wikiPages: [],
      freeHelp: [
        {
          title: 'Citizens Advice — problems with neighbours',
          url: caNeighbours,
          blurb: 'Noise, boundaries, anti-social behaviour, and when to involve the council.',
        },
        {
          title: 'GOV.UK — how to resolve neighbour disputes',
          url: govDisputes,
          blurb: 'Mediation, talking to your neighbour, and next steps.',
        },
      ],
      recommendedFirms: [],
      sources: [
        { title: 'Citizens Advice — problems with neighbours', url: caNeighbours, kind: 'trusted-guidance' },
        { title: 'GOV.UK — resolving neighbour disputes', url: govDisputes, kind: 'trusted-guidance' },
      ],
      citation: { ok: true, issues: [] },
      matchedTopicId: 'neighbour-access-dispute',
      policyNote:
        'Signposting only. Access rights depend on title deeds / easements — verify against your documents before taking formal steps.',
    }
    pack.citation = checkAnswerCitations(pack)
    return pack
  }

  if (parkingCase) {
    const officialHits = (session.authorityHits || []).filter(
      (h) => h.kind !== 'law_firm' && h.tier !== 'firm',
    )
    const caAppeal =
      'https://www.citizensadvice.org.uk/law-and-courts/parking-tickets/appealing-a-parking-ticket/'
    const caWhen =
      'https://www.citizensadvice.org.uk/law-and-courts/parking-tickets/when-to-appeal-a-parking-ticket/'
    const govParking = 'https://www.gov.uk/parking-tickets'
    const pack: AnswerPackage = {
      answerOverview:
        'For a charge from a private car park (not a council PCN), open guidance usually separates council Penalty Charge Notices from private parking charges. Check who issued the notice, keep evidence that machines/app failed, and use the operator’s appeal route then the independent appeal scheme (often POPLA or IAS) if you are still within time.',
      bullets: [
        {
          text: 'Confirm whether the notice is a council Penalty Charge Notice (PCN) or a private parking charge from an operator — the appeal routes differ.',
          sourceTitle: 'Citizens Advice — when to appeal a parking ticket',
          sourceUrl: caWhen,
          tier: 'trusted-guidance',
        },
        {
          text: 'For many private operator charges, you can appeal to the company first, then (if rejected and the operator is in the BPA scheme) to POPLA — keep screenshots of broken machines or failed payment apps.',
          sourceTitle: 'Citizens Advice — appealing a parking ticket',
          sourceUrl: caAppeal,
          tier: 'trusted-guidance',
        },
        {
          text: 'GOV.UK covers council parking tickets / PCNs and how to challenge them — use it to cross-check whether your notice is a council PCN rather than a private charge.',
          sourceTitle: 'GOV.UK — Parking tickets',
          sourceUrl: govParking,
          tier: 'trusted-guidance',
        },
      ],
      wikiPages: [],
      freeHelp: [
        {
          title: 'Citizens Advice — appealing a parking ticket',
          url: caAppeal,
          blurb: 'Council vs private parking charges and appeal pathways (incl. POPLA / IAS).',
        },
        {
          title: 'Citizens Advice — when to appeal',
          url: caWhen,
          blurb: 'Common reasons a ticket should be cancelled, including private land terms.',
        },
        {
          title: 'GOV.UK — Parking tickets',
          url: govParking,
          blurb: 'Official overview of council parking tickets / PCNs.',
        },
        ...officialHits.slice(0, 2).map((h) => ({
          title: h.title,
          url: h.url,
          blurb: 'Matched UK guidance for your story.',
        })),
      ],
      recommendedFirms: [],
      sources: [
        {
          title: 'Citizens Advice — appealing a parking ticket',
          url: caAppeal,
          kind: 'trusted-guidance',
        },
        {
          title: 'Citizens Advice — when to appeal a parking ticket',
          url: caWhen,
          kind: 'trusted-guidance',
        },
        {
          title: 'GOV.UK — Parking tickets',
          url: govParking,
          kind: 'trusted-guidance',
        },
      ],
      citation: { ok: true, issues: [] },
      matchedTopicId: 'private-parking-charge',
      policyNote:
        'Signposting only. Private parking vs council PCN routes differ — verify the issuer on the notice.',
    }
    pack.citation = checkAnswerCitations(pack)
    return pack
  }

  if (!carCase) {
    const firmHits = (session.authorityHits || []).filter(
      (h) => h.kind === 'law_firm' || h.tier === 'firm',
    )
    const officialHits = (session.authorityHits || []).filter(
      (h) => h.kind !== 'law_firm' && h.tier !== 'firm',
    )
    const firmBullets = firmHits.slice(0, 3).map((h) => ({
      text: `Law firm commentary (${h.firm || 'UK firm'}): ${h.title.replace(/\s*\|\s*.*$/, '')}. Firm blogs explain topics — they are not official GOV.UK guidance and not advice on your case.`,
      sourceTitle: `${h.firm || 'Law firm'} — ${h.title}`,
      sourceUrl: h.url,
      tier: 'law-firm-commentary' as const,
    }))
    const empty: AnswerPackage = {
      answerOverview: firmHits.length
        ? `No curated primary-law remedy package matched yet. ${officialHits.length ? 'Official signposts are listed under free help / guidance. ' : ''}We can cite ${firmHits.length} law-firm explainer(s) below — commentary only, not a recommendation to instruct that firm.`
        : 'No curated primary-law remedy package matched yet for this story. Use free help and the matched wiki pathway, then verify any statute on legislation.gov.uk.',
      bullets: firmBullets,
      wikiPages: [],
      freeHelp: [
        {
          title: 'Citizens Advice',
          url: 'https://www.citizensadvice.org.uk/get-advice/',
          blurb: 'Free guidance and local referral pathways.',
        },
        ...officialHits.slice(0, 3).map((h) => ({
          title: h.title,
          url: h.url,
          blurb: 'Trusted UK guidance (authority seed).',
        })),
      ],
      recommendedFirms: firmHits.slice(0, 3).map((h) => ({
        name: h.firm || 'UK law firm',
        directoryUrl: h.url,
        note: `Commentary article: ${h.title}. Not an endorsement — check SRA registration before instructing anyone.`,
      })),
      sources: [
        ...officialHits.map((h) => ({
          title: h.title,
          url: h.url,
          kind: 'trusted-guidance',
        })),
        ...firmHits.map((h) => ({
          title: `${h.firm}: ${h.title}`,
          url: h.url,
          kind: 'law-firm-commentary',
        })),
      ],
      citation: { ok: true, issues: [] },
      matchedTopicId: null,
      policyNote:
        'Policy: official guidance before firm blogs. Firm URLs are tertiary commentary cites — never primary law. Free help before instructing a firm.',
    }
    empty.citation = checkAnswerCitations(empty)
    return enrichAnswerPackageWithOslaw(empty, options.oslaw, session)
  }

  const sections = pickSections(text)
  const bullets: AnswerBullet[] = [
    {
      text: 'For a used car bought from a trader, the Consumer Rights Act 2015 usually requires goods to be of satisfactory quality, fit for purpose, and as described.',
      sourceTitle: 'CRA s.9 / s.10 / s.11',
      sourceUrl: 'https://www.legislation.gov.uk/ukpga/2015/15/section/9',
      tier: 'primary-law',
    },
    {
      text: 'Within about 30 days of delivery you may have a short-term right to reject for non-conformity; asking for a repair can pause that clock while you wait.',
      sourceTitle: 'CRA s.22',
      sourceUrl: 'https://www.legislation.gov.uk/ukpga/2015/15/section/22',
      tier: 'primary-law',
    },
    {
      text: 'After the short-term window, repair or replacement is often the first statutory route — within a reasonable time and without significant inconvenience.',
      sourceTitle: 'CRA s.23',
      sourceUrl: 'https://www.legislation.gov.uk/ukpga/2015/15/section/23',
      tier: 'primary-law',
    },
    {
      text: 'If one repair or replacement fails (faults remain) or repair is not done properly in time, you may choose a price reduction or the final right to reject — not both (CRA s.24(5)–(7)).',
      sourceTitle: 'CRA s.24(5)–(7)',
      sourceUrl: 'https://www.legislation.gov.uk/ukpga/2015/15/section/24',
      tier: 'primary-law',
    },
    {
      text: 'On final reject of a motor vehicle, a refund may be reduced for use — the usual first-6-months bar on use deduction does not apply to motor vehicles (CRA s.24(10)).',
      sourceTitle: 'CRA s.24(10)',
      sourceUrl: 'https://www.legislation.gov.uk/ukpga/2015/15/section/24',
      tier: 'primary-law',
    },
    {
      text: 'If a fault appears within 6 months of delivery, the Act generally treats it as present at delivery unless the trader proves otherwise (see CRA s.19).',
      sourceTitle: 'CRA s.19',
      sourceUrl: 'https://www.legislation.gov.uk/ukpga/2015/15/section/19',
      tier: 'primary-law',
    },
    {
      text: 'A warranty or Motor Ombudsman membership sits alongside CRA rights — it does not replace them. Citizens Advice frames trader vs private seller and practical steps.',
      sourceTitle: 'Citizens Advice — Buying a used car',
      sourceUrl: 'https://www.citizensadvice.org.uk/consumer/buying-or-repairing-a-car/buying-a-used-car/',
      tier: 'trusted-guidance',
    },
  ]

  // Filter bullets to those backed by selected sections + always keep guidance + s24 if repair
  const sectionUrls = new Set(sections.map((s) => s.url))
  const filtered = bullets.filter((b) => {
    if (b.tier === 'trusted-guidance') return true
    if (b.sourceUrl.includes('/section/24') && /repair|fault|reject|deduct/.test(text)) return true
    return sectionUrls.has(b.sourceUrl) || b.sourceUrl.includes('/section/9')
  })

  const wikiPages: AnswerWikiLink[] = [
    {
      title: craSpine.remedyPage.title,
      path: craSpine.remedyPage.wikiPath,
      tier: 'areas',
    },
    {
      title: 'Consumer Rights Act 2015 — repair and reject',
      path: craSpine.remedyPage.referencePath,
      tier: 'reference',
    },
  ]

  const freeHelp = [
    {
      title: 'Citizens Advice — used car problems',
      url: 'https://www.citizensadvice.org.uk/consumer/buying-or-repairing-a-car/buying-a-used-car/',
      blurb: 'Free rights framing and next steps (trader vs private seller).',
    },
    {
      title: 'Citizens Advice decision tree',
      url: 'https://www.citizensadvice.org.uk/consumer/buying-or-repairing-a-car/buying-a-used-car/problem-with-a-used-car/',
      blurb: 'Interactive tool for used-car problems.',
    },
  ]

  const sources = [
    ...sections.map((s) => ({
      title: s.label,
      url: s.url,
      kind: 'primary-law',
    })),
    ...craSpine.trustedGuidance.map((g) => ({
      title: g.title,
      url: g.url,
      kind: 'trusted-guidance',
    })),
  ]

  const pack: AnswerPackage = {
    answerOverview:
      'For a faulty used car bought from a trader, start with the Consumer Rights Act 2015 remedies ladder (short-term reject → repair/replacement → final reject or price reduction), then use Citizens Advice / Motor Ombudsman for process — not firm blogs as primary law. This is information and signposting, not advice on your specific outcome.',
    bullets: filtered,
    wikiPages,
    freeHelp,
    recommendedFirms: [], // 5+ firm-topic gate — empty until index qualifies
    sources,
    citation: { ok: true, issues: [] },
    matchedTopicId: 'car-reject-failed-repair',
    policyNote:
      'Free help first. Firms only from firm-topic-recommendations.json (5+ articles, SRA filter). Directory is never primary law.',
  }

  pack.citation = checkAnswerCitations(pack)
  return pack
}
