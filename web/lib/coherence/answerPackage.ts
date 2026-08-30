import type { ResearchBundle } from './researchBundle'

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
import { normaliseLayText } from './normaliseLay'
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

export type AnswerOption = {
  title: string
  description: string
}

export type AnswerFollowUp = {
  id: string
  label: string
  kind: 'clarify' | 'add_detail' | 'refine'
  prompt: string
}

export function defaultAnswerFollowUps(missingFacts: string[] = []): AnswerFollowUp[] {
  const firstMissing = missingFacts[0]
  return [
    {
      id: 'clarify',
      label: 'Clarify the guidance',
      kind: 'clarify',
      prompt: firstMissing
        ? `What do you want to know about: ${firstMissing}`
        : 'Which part of this guidance would you like explained more clearly?',
    },
    {
      id: 'add-detail',
      label: 'Add more detail',
      kind: 'add_detail',
      prompt: 'What else should we add to your timeline, documents or facts?',
    },
    {
      id: 'refine',
      label: 'Refine the result',
      kind: 'refine',
      prompt: 'What outcome or route should we focus on next?',
    },
  ]
}

export type AnswerPackage = {
  /** AGENTS.md sections */
  answerOverview: string
  bullets: AnswerBullet[]
  /** Practical actions grounded in the retrieved guidance. */
  recommendations: string[]
  /** Realistic routes the client can compare, without predicting an outcome. */
  options: AnswerOption[]
  /** Facts that could materially change the route or recommendation. */
  missingFacts: string[]
  /** First-class follow-up actions for the conversational overview. */
  followUps: AnswerFollowUp[]
  wikiPages: AnswerWikiLink[]
  freeHelp: { title: string; url: string; blurb: string }[]
  recommendedFirms: AnswerFirm[]
  sources: { title: string; url: string; kind: string }[]
  /** Optional supplemental bundle from the feature-flagged research provider. */
  researchBundle?: ResearchBundle
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

type CuratedPackDefinition = {
  id: string
  when: RegExp
  overview: string
  bullets: Array<[string, string, string]>
  help: Array<[string, string, string]>
  policy: string
}

function buildCuratedPack(def: CuratedPackDefinition): AnswerPackage {
  const bullets: AnswerBullet[] = def.bullets.map(([text, sourceTitle, sourceUrl]) => ({
    text,
    sourceTitle,
    sourceUrl,
    tier: 'trusted-guidance',
  }))
  const freeHelp = def.help.map(([title, url, blurb]) => ({ title, url, blurb }))
  const pack: AnswerPackage = {
    answerOverview: def.overview,
    bullets,
    recommendations: bullets.map((b) => b.text).slice(0, 4),
    options: [
      {
        title: 'Follow the recommended next steps',
        description: 'Use the cited guidance and evidence checklist to progress the matter yourself.',
      },
      {
        title: 'Get independent help',
        description: 'Ask Citizens Advice or a solicitor to review the facts if the route or wording is uncertain.',
      },
    ],
    missingFacts: ['Exact dates, documents, contract or notice wording, and the outcome you want.'],
    followUps: defaultAnswerFollowUps([
      'Exact dates, documents, contract or notice wording, and the outcome you want.',
    ]),
    wikiPages: [],
    freeHelp,
    recommendedFirms: [],
    sources: [
      ...bullets.map((b) => ({ title: b.sourceTitle, url: b.sourceUrl, kind: b.tier })),
      ...freeHelp.map((h) => ({ title: h.title, url: h.url, kind: 'trusted-guidance' })),
    ],
    citation: { ok: true, issues: [] },
    matchedTopicId: def.id,
    policyNote: def.policy,
  }
  pack.citation = checkAnswerCitations(pack)
  return pack
}

const CURATED_LEAD_PACKS: CuratedPackDefinition[] = [
  {
    id: 'property-transfer-conveyancing',
    when: /\b(conveyanc|transfer(?:ring)? (?:of )?(?:equity|property|ownership)|add name to title|remove name from title|title deeds?|lease extension|remortgag|buying (?:a )?(?:property|flat|house)|selling (?:a )?(?:property|flat|house)|buying and\/or selling|buying or selling)\b/i,
    overview:
      'Property transfer questions usually turn on the title, the ownership structure, any lender or lease restrictions, and the tax and Land Registry steps. Confirm whether this is a sale, gift, transfer of equity, remortgage, or title correction before signing anything.',
    bullets: [
      ['Confirm whether this is a sale, gift, transfer of equity, remortgage, or title correction; each follows a different conveyancing route.', 'GOV.UK — buying or selling your home', 'https://www.gov.uk/buy-sell-your-home'],
      ['Check the title register, restrictions, lease terms, and mortgage consent requirements before agreeing the transfer.', 'HM Land Registry — registering land and property', 'https://www.gov.uk/government/collections/registering-land-and-property-with-land-registry'],
      ['Keep valuations and tax correspondence, and check Stamp Duty Land Tax or Capital Gains Tax before completion.', 'GOV.UK — Stamp Duty Land Tax', 'https://www.gov.uk/stamp-duty-land-tax'],
    ],
    help: [
      ['GOV.UK — buying or selling your home', 'https://www.gov.uk/buy-sell-your-home', 'Official conveyancing and transaction guidance.'],
      ['HM Land Registry', 'https://www.gov.uk/government/organisations/land-registry', 'Official title and registration information.'],
    ],
    policy: 'Property transfer pack: verify title, lender, lease, tax, and registration requirements. Signposting only, not legal advice.',
  },
  {
    id: 'wills-lpa-trusts',
    when: /\b(probates?|executor|letters of administration|lasting power of attorney|power of attorney|lpa|trust(?:s|ee|ees)?)\b|(?:make|making|draft|drafting|write|writing|update|change).{0,30}\bwill\b/i,
    overview:
      'Wills, lasting powers of attorney, trusts, and estate administration use different documents and formalities. Identify the document first, then follow the relevant official process before signing, registering, or distributing assets.',
    bullets: [
      ['Check the signing and witnessing requirements for a will before relying on it or changing an earlier version.', 'GOV.UK — make a will', 'https://www.gov.uk/make-will'],
      ['A lasting power of attorney generally needs registration before an attorney can use it.', 'GOV.UK — power of attorney', 'https://www.gov.uk/power-of-attorney'],
      ['Executors and administrators should use the probate process and keep estate valuations, debts, and correspondence.', 'GOV.UK — applying for probate', 'https://www.gov.uk/applying-for-probate'],
    ],
    help: [
      ['GOV.UK — make a will', 'https://www.gov.uk/make-will', 'Official will-making guidance.'],
      ['GOV.UK — power of attorney', 'https://www.gov.uk/power-of-attorney', 'Official LPA and attorney guidance.'],
    ],
    policy: 'Wills and estate pack: official process first; formal validity depends on the facts and document.',
  },
  {
    id: 'family-agreement',
    when: /\b(clean break|separation agreement|financial order|consent order|cohabitation agreement|prenup|pre-?nuptial|post-?nuptial|parenting agreement|family agreement)\b/i,
    overview:
      'Family agreements should distinguish financial and property arrangements from child arrangements. Mediation may help where safe and suitable, while a clean break or other financial settlement may need a court order to be formally recorded.',
    bullets: [
      ['List finances, property, pensions, and child arrangements separately so each issue follows the right process.', 'GOV.UK — money and property when a relationship ends', 'https://www.gov.uk/money-property-when-relationship-ends'],
      ['Consider mediation or another supported negotiation route where it is safe and appropriate.', 'GOV.UK — family mediation', 'https://www.gov.uk/try-mediation'],
      ['Check whether a clean break or consent arrangement needs a court order and keep the signed version.', 'GOV.UK — apply for a financial order', 'https://www.gov.uk/apply-financial-order'],
    ],
    help: [
      ['GOV.UK — money and property when a relationship ends', 'https://www.gov.uk/money-property-when-relationship-ends', 'Official separation and financial guidance.'],
      ['GOV.UK — family mediation', 'https://www.gov.uk/try-mediation', 'Official mediation information.'],
    ],
    policy: 'Family agreement pack: separate financial, property, and child issues; signposting only.',
  },
  {
    id: 'commercial-business-contracts',
    when: /\b(business|commercial|company|companies|supplier|customer|client|trade|shop|retail|partnership|sole trader)\b[\s\S]{0,100}\b(contract|agreement|terms|lease|licence|invoice|unpaid|dispute|draft|review|breach|termination)\b/i,
    overview:
      'A business contract recommendation should start with the parties, scope, price, performance, and termination terms. Preserve the signed agreement and communications, then follow any contractual notice or dispute process.',
    bullets: [
      ['Record the parties, scope, price, payment dates, delivery standards, and termination provisions clearly.', 'GOV.UK — starting a business', 'https://www.gov.uk/starting-up-a-business'],
      ['Keep the signed contract, variations, invoices, and dated messages showing performance or breach.', 'GOV.UK — business legal structures', 'https://www.gov.uk/business-legal-structures'],
      ['Check notice, escalation, governing-law, and dispute clauses before sending a formal demand.', 'GOV.UK — make a court claim for money', 'https://www.gov.uk/make-court-claim-for-money'],
    ],
    help: [
      ['GOV.UK — starting a business', 'https://www.gov.uk/starting-up-a-business', 'Official business setup guidance.'],
      ['GOV.UK — make a court claim for money', 'https://www.gov.uk/make-court-claim-for-money', 'Official money-claim process.'],
    ],
    policy: 'Commercial contract pack: contract wording and evidence control the route; signposting only.',
  },
  {
    id: 'legal-document-certification',
    when: /\b(statutory declaration|affidavit|deed|certif(?:y|ied|ication)|notar(?:y|ise|ized|ised)|apostille|legalis(?:e|ation)|witness(?:ed|ing)?)\b/i,
    overview:
      'Certification, witnessing, notarisation, and legalisation are different processes. Confirm exactly what the receiving organisation requires before signing or arranging an apostille.',
    bullets: [
      ['Confirm whether the recipient needs a certified copy, witness, solicitor, notary, or apostille.', 'GOV.UK — certifying a document', 'https://www.gov.uk/certifying-document'],
      ['Follow the document-specific signing and witnessing sequence for a declaration, affidavit, or deed.', 'GOV.UK — statutory declarations', 'https://www.gov.uk/government/publications/statutory-declarations'],
      ['For overseas use, check whether the destination requires an apostille or other legalisation.', 'GOV.UK — get a document legalised', 'https://www.gov.uk/get-document-legalised'],
    ],
    help: [
      ['GOV.UK — certifying a document', 'https://www.gov.uk/certifying-document', 'Official certification guidance.'],
      ['GOV.UK — get a document legalised', 'https://www.gov.uk/get-document-legalised', 'Official overseas legalisation guidance.'],
    ],
    policy: 'Legal-document pack: recipient requirements determine the necessary formality; signposting only.',
  },
  {
    id: 'tax-estate-banking',
    when: /\b(inheritance tax|iht|capital gains tax|stamp duty|bank account|banking|executor.{0,30}(?:account|funds)|estate.{0,30}(?:tax|account|funds)|probate.{0,30}(?:bank|tax)|(?:late|deceased|died|death).{0,80}(?:isa|premium bonds|bank|account|savings))\b/i,
    overview:
      'Estate and banking questions can involve inheritance tax, other taxes, probate authority, and the bank’s own requirements. Keep valuations, statements, liabilities, gifts, and correspondence together while confirming which process applies.',
    bullets: [
      ['Separate inheritance tax and estate administration steps from capital gains or income tax questions.', 'GOV.UK — inheritance tax', 'https://www.gov.uk/inheritance-tax'],
      ['Gather account statements, asset valuations, liabilities, gifts, and property information for the estate record.', 'GOV.UK — valuing an estate', 'https://www.gov.uk/valuing-estate-of-someone-who-died'],
      ['Ask the bank what grant or other authority it needs before closing or transferring estate funds.', 'GOV.UK — applying for probate', 'https://www.gov.uk/applying-for-probate'],
    ],
    help: [
      ['GOV.UK — inheritance tax', 'https://www.gov.uk/inheritance-tax', 'Official estate-tax guidance.'],
      ['GOV.UK — applying for probate', 'https://www.gov.uk/applying-for-probate', 'Official probate process.'],
    ],
    policy: 'Estate and banking pack: verify tax, authority, and asset-specific requirements before acting.',
  },
]

function curatedLeadPack(text: string): AnswerPackage | null {
  const definition = CURATED_LEAD_PACKS.find((candidate) => candidate.when.test(text))
  return definition ? buildCuratedPack(definition) : null
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
  const text = normaliseLayText(blob(session, frames))
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
      recommendations: [
        'Check the title, ownership and any right of way before choosing a remedy.',
        'Keep dated photographs, messages and records of blocked access.',
        'Try written contact or mediation before court where safe and practical.',
      ],
      options: [
        {
          title: 'Informal resolution or mediation',
          description: 'A lower-cost route focused on restoring access without court.',
        },
        {
          title: 'Formal civil action',
          description: 'Consider professional advice if access remains blocked or informal steps fail.',
        },
      ],
      missingFacts: ['Whether the land is solely yours, shared, or subject to a right of way.'],
      followUps: defaultAnswerFollowUps(['Whether the land is solely yours, shared, or subject to a right of way.']),
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
      recommendations: [
        'Confirm whether the notice is from a council or a private parking operator.',
        'Preserve the notice, photographs, payment records and any app or machine evidence.',
        'Use the issuer’s appeal route before considering further escalation.',
      ],
      options: [
        {
          title: 'Appeal the charge',
          description: 'Use the available appeal process if the evidence supports a challenge and the deadline is open.',
        },
        {
          title: 'Seek independent help',
          description: 'Use Citizens Advice or the relevant independent appeal scheme to check the next stage.',
        },
      ],
      missingFacts: ['Who issued the notice and whether the appeal deadline has passed.'],
      followUps: defaultAnswerFollowUps(['Who issued the notice and whether the appeal deadline has passed.']),
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
    const curated = curatedLeadPack(text)
    if (curated) return curated
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
      recommendations: [
        'Start with the official guidance listed under free help.',
        'Gather the contract, notices, payments and dated communications.',
        'Use the provider’s complaint or dispute process before paid legal help.',
      ],
      options: [
        {
          title: 'Self-help and formal complaint',
          description: 'Use the provider’s process with a clear explanation and supporting evidence.',
        },
        {
          title: 'Independent advice',
          description: 'Ask Citizens Advice or a solicitor to review the documents if the dispute remains unresolved.',
        },
      ],
      missingFacts: ['The governing contract, jurisdiction and exact remedy sought.'],
      followUps: defaultAnswerFollowUps(['The governing contract, jurisdiction and exact remedy sought.']),
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
    recommendations: [
      'Identify which Consumer Rights Act remedy fits the timing and repair history.',
      'Keep the sale contract, fault evidence, repair records and communications.',
      'Set out the requested remedy in writing before escalating.',
    ],
    options: [
      {
        title: 'Repair or replacement',
        description: 'Often the first route after the short-term rejection period, subject to statutory conditions.',
      },
      {
        title: 'Price reduction or final rejection',
        description: 'May become relevant if repair or replacement fails or is not provided properly and promptly.',
      },
    ],
    missingFacts: ['Purchase date, trader status, fault history and whether a repair has already failed.'],
    followUps: defaultAnswerFollowUps([
      'Purchase date, trader status, fault history and whether a repair has already failed.',
    ]),
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
