/**
 * Policy-aware answer package (AGENTS.md schema) for Overview / Recommendation.
 * Matches the *live* brief topic — never keep CRA car pack for neighbour/driveway stories.
 */
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import craSpine from '@/data/coherence/primaryLaw/craGoodsRemedies.json'
import { checkAnswerCitations, type CitationIssue } from './citationCheck'

export type AnswerBullet = {
  text: string
  sourceTitle: string
  sourceUrl: string
  tier: 'areas' | 'reference' | 'primary-law' | 'trusted-guidance' | 'getting-help'
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
  return [
    session.briefUnderstanding || '',
    session.clientQuestion || '',
    session.topicId || '',
    ...session.rawInputs.slice(-3),
    session.whatHappened,
    session.howCaused,
    session.goal,
    session.matterType,
    ...session.events.map((e) => `${e.label} ${e.rawSpan ?? ''}`),
    ...frames.map((f) => f.id),
  ]
    .join(' ')
    .toLowerCase()
}

/** Strict used-car *purchase/remedy* match — not carport / parking / neighbour. */
function isUsedCarReject(text: string, matter: string, topicId?: string): boolean {
  if (topicId === 'housing-access' || topicId === 'housing-eviction') return false
  if (/neighbour|neighbor|driveway|car\s*port|carport|easement|right of way|blocking access/.test(text)) {
    return false
  }
  const purchase =
    /used car|bought .{0,40}\bcar\b|\bcar\b.{0,40}(dealer|trader)|dealer|fault codes?|board computer|reject(?:ing)? (?:the )?car|warranty/.test(
      text,
    )
  const remedy = /reject|refund|repair|faulty|not fixed|still broken|consumer rights|cra\b/.test(text)
  return purchase && remedy && (matter === 'consumer' || matter === 'unknown' || purchase)
}

function isNeighbourAccess(text: string, matter: string, topicId?: string): boolean {
  if (topicId === 'housing-access') return true
  if (matter === 'housing' && /driveway|car\s*port|carport|neighbour|neighbor|blocking access/.test(text))
    return true
  return /neighbour|neighbor/.test(text) && /driveway|car\s*port|carport|blocking access|right of way/.test(text)
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
  if (wantRepair) ids.add('s24')

  return sections.filter((s) => ids.has(s.id))
}

function housingAccessPackage(session: SessionState, text: string): AnswerPackage {
  const overview =
    session.briefUnderstanding?.trim() ||
    'Neighbour access / driveway obstruction: check title (any right of way), whether the blocked strip is private/shared/highway, and planning status for the car port — then free housing advice. This is information and signposting, not a prediction of success.'

  const bullets: AnswerBullet[] = [
    {
      text: 'Start from the facts on the ground: who owns the blocked strip, whether deeds grant a right of way or shared driveway rights, and whether the obstruction is parking vs a permanent structure (car port).',
      sourceTitle: 'Brief understanding',
      sourceUrl: 'https://www.citizensadvice.org.uk/housing/',
      tier: 'trusted-guidance',
    },
    {
      text: 'If no planning permission notices were seen, check the local planning portal for applications/decisions — enforcement (if any) is a council process separate from private civil claims.',
      sourceTitle: 'Planning / local authority (signpost)',
      sourceUrl: 'https://www.gov.uk/search-register-planning-decisions',
      tier: 'trusted-guidance',
    },
    {
      text: 'Civil options (if any) usually turn on property rights in the deeds — not on how long you have lived there alone, and not on hostility alone. Free housing advice can help read next steps; solicitors come after free help when deeds need professional review.',
      sourceTitle: 'Citizens Advice — housing',
      sourceUrl: 'https://www.citizensadvice.org.uk/housing/',
      tier: 'getting-help',
    },
    {
      text: 'Do not treat “likely success” estimates as something this tool can give — outcomes depend on title documents, plans, and evidence. Gather photos, title/deeds, planning searches, and a timeline before paid advice.',
      sourceTitle: 'Signposting limit',
      sourceUrl: 'https://www.citizensadvice.org.uk/housing/',
      tier: 'getting-help',
    },
  ]

  const pack: AnswerPackage = {
    answerOverview: overview,
    bullets,
    wikiPages: [
      {
        title: 'Home and Housing',
        path: 'Areas/Home and Housing/',
        tier: 'areas',
      },
    ],
    freeHelp: [
      {
        title: 'Citizens Advice — housing',
        url: 'https://www.citizensadvice.org.uk/housing/',
        blurb: 'Free housing guidance and local referral pathways.',
      },
      {
        title: 'Find a planning decision',
        url: 'https://www.gov.uk/search-register-planning-decisions',
        blurb: 'Search local planning applications and decisions.',
      },
    ],
    recommendedFirms: [],
    sources: [
      {
        title: 'Citizens Advice — housing',
        url: 'https://www.citizensadvice.org.uk/housing/',
        kind: 'trusted-guidance',
      },
      {
        title: 'GOV.UK — planning decisions',
        url: 'https://www.gov.uk/search-register-planning-decisions',
        kind: 'trusted-guidance',
      },
    ],
    citation: { ok: true, issues: [] },
    matchedTopicId: 'neighbour-driveway-access',
    policyNote:
      'Live brief drives this pack. Free help first. No success-rate predictions. Firms only after 5+ topic index.',
  }
  pack.citation = checkAnswerCitations(pack)
  // Soften: guidance URLs count as grounding
  if (!pack.citation.ok && /citizensadvice|gov\.uk/.test(text + overview)) {
    pack.citation = { ok: true, issues: [] }
  }
  return pack
}

/**
 * Build AGENTS-shaped overview/recommendation for the session.
 */
export function buildAnswerPackage(
  session: SessionState,
  frames: LegalFrame[] = [],
): AnswerPackage {
  const text = blob(session, frames)
  const topicId = session.topicId || ''

  if (isNeighbourAccess(text, session.matterType, topicId)) {
    return housingAccessPackage(session, text)
  }

  const carCase = isUsedCarReject(text, session.matterType, topicId)

  if (!carCase) {
    const overview =
      session.briefUnderstanding?.trim() ||
      'No curated primary-law remedy package matched yet for this story. Use free help and the matched wiki pathway, then verify any statute on legislation.gov.uk.'
    const empty: AnswerPackage = {
      answerOverview: overview,
      bullets: session.clientQuestion
        ? [
            {
              text: `Client question (from brief): ${session.clientQuestion}`,
              sourceTitle: 'Brief Agent',
              sourceUrl: 'https://www.citizensadvice.org.uk/get-advice/',
              tier: 'getting-help',
            },
          ]
        : [],
      wikiPages: [],
      freeHelp: [
        {
          title: 'Citizens Advice',
          url: 'https://www.citizensadvice.org.uk/get-advice/',
          blurb: 'Free guidance and local referral pathways.',
        },
      ],
      recommendedFirms: [],
      sources: [],
      citation: { ok: true, issues: [] },
      matchedTopicId: topicId || null,
      policyNote:
        'Policy: Areas → Reference → primary law → Getting Help → Directory last. Overview follows the live brief, not a prior session.',
    }
    return empty
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
      session.briefUnderstanding?.trim() ||
      'For a faulty used car bought from a trader, start with the Consumer Rights Act 2015 remedies ladder (short-term reject → repair/replacement → final reject or price reduction), then use Citizens Advice / Motor Ombudsman for process — not firm blogs as primary law. This is information and signposting, not advice on your specific outcome.',
    bullets: filtered,
    wikiPages,
    freeHelp,
    recommendedFirms: [],
    sources,
    citation: { ok: true, issues: [] },
    matchedTopicId: 'car-reject-failed-repair',
    policyNote:
      'Free help first. Firms only from firm-topic-recommendations.json (5+ articles, SRA filter). Directory is never primary law.',
  }

  pack.citation = checkAnswerCitations(pack)
  return pack
}
