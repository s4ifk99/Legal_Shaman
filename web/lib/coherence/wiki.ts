import type { Jurisdiction, MatterType, SessionState } from './types'
import { buildRetrievalText } from './retrievalText'
import type { LegalFrame } from './frames'
import type { KnowledgeHit } from './knowledgeTypes'
import {
  buildHeuristicRightsSummary,
  loadSourceSnippets,
  type SourceSnippet,
} from './oslawSummary'
import { RIGHTS_CAVEAT, type RightsSummary } from './oslawRights'
import { normaliseLayText } from './normaliseLay'
import {
  buildRightsFromWiki,
  featuredToolsFromWiki,
  isBenefitsRulesStory,
  isLeaseholdFireSafetyAlterationStory,
  isPrivateParkingStory,
  isUsedCarPurchaseStory,
  isVictimCommunicationsHarassmentStory,
  linkedTopicPages,
  synthesizeStepsFromWiki,
} from './wikiOslaw'

export type WikiPageKind = 'topic' | 'pathway' | 'entity' | 'index' | 'tool'
export type WikiDomainId =
  | 'immigration'
  | 'housing'
  | 'employment'
  | 'debt'
  | 'family'
  | 'consumer'
  | 'crime'

export interface WikiPage {
  id: string
  kind: WikiPageKind
  title: string
  jurisdiction: string
  frameIds: string[]
  primaryUrl: string
  sourceIds: string[]
  sourceUrls: string[]
  contradictions: string[]
  snippet: string
  path: string
  keywords: string[]
  authority?: 'primary' | 'secondary' | 'tertiary'
  /** Compiled OSLAW rights overview (Karpathy wiki compile) */
  oslawRightsOverview?: string
  oslawRightsBullets?: { text: string; sourceTitle?: string; sourceUrl?: string }[]
  oslawSteps?: {
    id: string
    label: string
    detail: string
    sourceUrl?: string
    sourceTitle?: string
    toolId?: string
    when?: string
  }[]
  oslawToolIds?: string[]
  oslawOrigin?: 'rules' | 'llm'
  oslawEnrichedAt?: string
  linkedTopicIds?: string[]
  toolMeta?: {
    url: string
    detail: string
    when?: string
    provider?: string
    pathwayIds?: string[]
  }
}

export interface WikiHit extends KnowledgeHit {
  kind: WikiPageKind
  frameIds: string[]
  jurisdiction: string
  contradictions: string[]
  sourceIds: string[]
  sourceUrls?: string[]
  domainId?: WikiDomainId
  authority?: 'primary' | 'secondary' | 'tertiary'
}

/** OSLAW: ranked wiki pathways turned into a practical course of action (not legal advice). */
export interface OslawCourseStep {
  id: string
  label: string
  detail: string
  url?: string
  /** Human title for the linked open source */
  sourceTitle?: string
}

export interface OslawCourse {
  pathwayId: string
  title: string
  summary: string
  domainId?: WikiDomainId
  authority?: string
  primaryUrl: string
  /** Rights overview grounded in matched open sources */
  rights: RightsSummary
  /** Snippets used to build / refine the rights summary */
  sourceSnippets: SourceSnippet[]
  /** Interactive open tools (e.g. CAB decision trees) matched to the story */
  featuredTools: { id: string; title: string; detail: string; url: string }[]
  steps: OslawCourseStep[]
  related: { title: string; url: string; kind: string }[]
  disclaimer: string
}

export interface WikiCatalogue {
  collection: string
  pattern: string
  trialDomain: string
  domainId?: string
  wikiRoot: string
  compiledAt: string
  articleCount: number
  pageCount: number
  pages: WikiPage[]
}

export interface BriefSource {
  title: string
  url_or_id: string
  jurisdiction: string
  snippet: string
}

const AUTHORITY_BOOST: Record<string, number> = {
  primary: 4,
  secondary: 1,
  tertiary: -2,
}

/** Demote Visas/citizenship URLs when scoring non-immigration domain pages. */
const IMM_CITIZENSHIP_URL_NOISE =
  /immigration|visa|asylum|appendix-?fm|citizenship|british-citizen|leave-to-remain|suitability-section|deprivation-of-british|entry-clearance|cancellation-of-permission|indefinite-leave|settled-status/i

const DOMAIN_LOADERS: Record<WikiDomainId, () => Promise<{ default: WikiCatalogue }>> = {
  immigration: () =>
    import('@/data/coherence/immigrationWiki.json') as Promise<{ default: WikiCatalogue }>,
  housing: () => import('@/data/coherence/wikis/housingWiki.json') as Promise<{ default: WikiCatalogue }>,
  employment: () =>
    import('@/data/coherence/wikis/employmentWiki.json') as Promise<{ default: WikiCatalogue }>,
  debt: () => import('@/data/coherence/wikis/debtWiki.json') as Promise<{ default: WikiCatalogue }>,
  family: () => import('@/data/coherence/wikis/familyWiki.json') as Promise<{ default: WikiCatalogue }>,
  consumer: () =>
    import('@/data/coherence/wikis/consumerWiki.json') as Promise<{ default: WikiCatalogue }>,
  crime: () => import('@/data/coherence/wikis/crimeWiki.json') as Promise<{ default: WikiCatalogue }>,
}

const wikiCaches = new Map<WikiDomainId, WikiCatalogue>()

const FRAME_PREFIX_TO_DOMAIN: Record<string, WikiDomainId> = {
  'imm-': 'immigration',
  'hous-': 'housing',
  'emp-': 'employment',
  'debt-': 'debt',
  'fam-': 'family',
  'cons-': 'consumer',
  'crime-': 'crime',
}

const MATTER_TO_DOMAIN: Partial<Record<MatterType, WikiDomainId>> = {
  immigration: 'immigration',
  housing: 'housing',
  employment: 'employment',
  debt: 'debt',
  family: 'family',
  consumer: 'consumer',
  crime: 'crime',
}

export async function loadWiki(domain: WikiDomainId = 'immigration'): Promise<WikiCatalogue> {
  const cached = wikiCaches.get(domain)
  if (cached) return cached
  const loader = DOMAIN_LOADERS[domain]
  const mod = await loader()
  const catalogue = mod.default as WikiCatalogue
  wikiCaches.set(domain, catalogue)
  return catalogue
}

type LeadOslawFallback = {
  id: string
  title: string
  summary: string
  url: string
  overview: string
  bullets: string[]
  steps: { id: string; label: string; detail: string; url: string; sourceTitle: string }[]
  when: RegExp
}

/**
 * Small, cited OSLAW pathways for high-volume areas that do not yet have a
 * compiled domain catalogue. These are deliberately scoped to open guidance
 * and never replace a catalogue match where one exists.
 */
const LEAD_OSLAW_FALLBACKS: LeadOslawFallback[] = [
  {
    id: 'pathway-wills-lpa-trusts',
    title: 'Wills, powers of attorney and trusts',
    summary: 'A practical open-guidance route for planning ahead, appointing decision-makers, or dealing with trusts and estates.',
    url: 'https://www.gov.uk/make-will',
    overview:
      'GOV.UK guidance covers making or changing a will, appointing attorneys under a lasting power of attorney, and the roles around trusts and estates. The correct document and formalities depend on the person’s circumstances, so the linked guidance should be checked before signing.',
    bullets: [
      'A will should be checked for signing and witnessing formalities; GOV.UK explains the basic process.',
      'A lasting power of attorney must be registered before an attorney can generally use it.',
      'Trustee, executor, and attorney duties are distinct roles — use the matching official guide.',
    ],
    steps: [
      { id: 'identify-document', label: 'Identify the document', detail: 'Decide whether the issue is a will, lasting power of attorney, trust, or estate administration question.', url: 'https://www.gov.uk/make-will', sourceTitle: 'GOV.UK: Make a will' },
      { id: 'check-formalities', label: 'Check formalities', detail: 'Read the relevant GOV.UK process before signing, witnessing, registering, or distributing assets.', url: 'https://www.gov.uk/power-of-attorney', sourceTitle: 'GOV.UK: Power of attorney' },
      { id: 'keep-records', label: 'Keep the paperwork', detail: 'Keep signed originals, registration details, valuations, and correspondence together for the people who may need them.', url: 'https://www.gov.uk/applying-for-probate', sourceTitle: 'GOV.UK: Applying for probate' },
    ],
    when: /\b(?:make|making|draft|drafting|write|writing|update|change|set up|lasting power of attorney|power of attorney|lpa|trust|trustee|probate|executor|letters of administration)\b/i,
  },
  {
    id: 'pathway-family-agreements',
    title: 'Family and separation agreements',
    summary: 'Open guidance on recording financial, property, and parenting arrangements after separation or before marriage.',
    url: 'https://www.gov.uk/money-property-when-relationship-ends',
    overview:
      'When relationships change, open guidance distinguishes informal arrangements, mediation, and court-approved financial or child arrangements. A written agreement or order can matter later, particularly where property, pensions, or children are involved.',
    bullets: [
      'A clean-break or other financial arrangement may need a court order to record it formally.',
      'Mediation and a written parenting plan are common first steps where it is safe and suitable.',
      'Keep full financial disclosure and signed agreement versions, including dates and review points.',
    ],
    steps: [
      { id: 'map-arrangements', label: 'List what needs agreeing', detail: 'Separate finances and property from child arrangements so each issue follows the right process.', url: 'https://www.gov.uk/money-property-when-relationship-ends', sourceTitle: 'GOV.UK: Money and property when a relationship ends' },
      { id: 'consider-mediation', label: 'Consider a supported agreement', detail: 'Check whether mediation or another supported negotiation route is appropriate and safe.', url: 'https://www.gov.uk/try-mediation', sourceTitle: 'GOV.UK: Family mediation' },
      { id: 'formalise', label: 'Check formalisation', detail: 'Where a financial clean break or consent arrangement is intended, check whether a court order is needed.', url: 'https://www.gov.uk/apply-financial-order', sourceTitle: 'GOV.UK: Apply for a financial order' },
    ],
    when: /\b(clean break|separation agreement|financial order|consent order|cohabitation agreement|prenup|pre-?nuptial|post-?nuptial|parenting agreement|family agreement)\b/i,
  },
  {
    id: 'pathway-commercial-business-contracts',
    title: 'Commercial and business contracts',
    summary: 'An open-guidance route for drafting, reviewing, or dealing with a contract used in a business or commercial setting.',
    url: 'https://www.gov.uk/starting-up-a-business',
    overview:
      'Business guidance covers choosing a structure, recording terms, and keeping commercial records. A contract dispute usually turns on the wording, performance evidence, notice provisions, and the loss or remedy being claimed.',
    bullets: [
      'Record the parties, scope, price, payment dates, delivery standards, and termination terms clearly.',
      'Keep the signed contract, variations, invoices, and dated communications in one evidence file.',
      'Check dispute, notice, governing-law, and escalation clauses before sending a formal demand.',
    ],
    steps: [
      { id: 'identify-business', label: 'Identify the business relationship', detail: 'Confirm whether this is a supplier, customer, partnership, company, or commercial premises arrangement.', url: 'https://www.gov.uk/business-legal-structures', sourceTitle: 'GOV.UK: Business legal structures' },
      { id: 'collect-contract', label: 'Collect the contract record', detail: 'Gather the signed terms, order forms, invoices, variations, and messages showing what happened.', url: 'https://www.gov.uk/starting-up-a-business', sourceTitle: 'GOV.UK: Starting a business' },
      { id: 'follow-notice', label: 'Follow the escalation route', detail: 'Use any contractual notice or dispute process before considering court or another remedy.', url: 'https://www.gov.uk/make-court-claim-for-money', sourceTitle: 'GOV.UK: Make a court claim for money' },
    ],
    when: /\b(business|commercial|company|companies|supplier|customer|client|trade|shop|retail|partnership|sole trader)\b[\s\S]{0,100}\b(contract|agreement|terms|lease|licence|invoice|unpaid|dispute|draft|review|breach|termination)\b/i,
  },
  {
    id: 'pathway-legal-documents-certification',
    title: 'Legal documents and certification',
    summary: 'Open guidance on statutory declarations, affidavits, witnessing, certification, notarisation, and legalisation.',
    url: 'https://www.gov.uk/certifying-document',
    overview:
      'Different documents require different people and formalities: certification is not the same as witnessing, notarisation, or legalisation. Official guidance explains the process and when an apostille or other authentication may be needed.',
    bullets: [
      'Check exactly whether the recipient requires a certified copy, witness, solicitor, notary, or apostille.',
      'Do not sign a declaration or deed until the required signing and witnessing sequence is clear.',
      'Keep the original, certified copy, receipt, and the receiving organisation’s requirements.',
    ],
    steps: [
      { id: 'check-requirement', label: 'Confirm the receiving requirement', detail: 'Ask the organisation what form of certification, witnessing, notarisation, or legalisation it accepts.', url: 'https://www.gov.uk/certifying-document', sourceTitle: 'GOV.UK: Certifying a document' },
      { id: 'sign-correctly', label: 'Use the correct formalities', detail: 'Follow the document-specific signing and witnessing instructions before submitting it.', url: 'https://www.gov.uk/government/publications/statutory-declarations', sourceTitle: 'GOV.UK: Statutory declarations' },
      { id: 'legalise-if-needed', label: 'Legalise for overseas use if required', detail: 'Check whether the receiving country needs an apostille or other legalisation step.', url: 'https://www.gov.uk/get-document-legalised', sourceTitle: 'GOV.UK: Get a document legalised' },
    ],
    when: /\b(statutory declaration|affidavit|deed|certif(?:y|ied|ication)|notar(?:y|ise|ized|ised)|apostille|legalis(?:e|ation)|witness(?:ed|ing)?|power of attorney)\b/i,
  },
  {
    id: 'pathway-tax-estate-banking',
    title: 'Tax, estates and banking',
    summary: 'An open-guidance route for inheritance tax, estate funds, property tax, and bank-account questions after a death or transfer.',
    url: 'https://www.gov.uk/inheritance-tax',
    overview:
      'Official guidance separates inheritance tax, capital gains tax, income tax, and the administration of estate money. Bank and executor steps depend on the account holder, the grant or other authority available, and the type of asset.',
    bullets: [
      'Inheritance tax and estate administration have separate reporting and payment steps.',
      'Keep valuations, debts, gifts, account statements, and property information for the relevant tax return.',
      'Ask the bank which authority it needs before transferring or closing an estate account.',
    ],
    steps: [
      { id: 'identify-tax', label: 'Identify the tax or estate step', detail: 'Work out whether the question concerns inheritance tax, capital gains tax, income tax, or banking authority.', url: 'https://www.gov.uk/inheritance-tax', sourceTitle: 'GOV.UK: Inheritance Tax' },
      { id: 'collect-valuations', label: 'Collect financial evidence', detail: 'Gather account statements, asset valuations, liabilities, gifts, and correspondence with the bank or personal representatives.', url: 'https://www.gov.uk/valuing-estate-of-someone-who-died', sourceTitle: 'GOV.UK: Valuing an estate' },
      { id: 'check-deadlines', label: 'Check the current deadline', detail: 'Use the official tax and probate guidance for the applicable reporting and payment deadlines.', url: 'https://www.gov.uk/tax', sourceTitle: 'GOV.UK: Tax' },
    ],
    when: /\b(inheritance tax|IHT|capital gains tax|stamp duty|bank account|banking|executor.{0,30}(?:account|funds)|estate.{0,30}(?:tax|account|funds)|probate.{0,30}(?:bank|tax))\b/i,
  },
]

function buildLeadOslawFallback(text: string): OslawCourse | null {
  const fallback = LEAD_OSLAW_FALLBACKS.find((candidate) => candidate.when.test(text))
  if (!fallback) return null
  const sourceSnippets: SourceSnippet[] = fallback.steps.map((step) => ({
    title: step.sourceTitle,
    url: step.url,
    preview: step.detail,
    authority: 'primary',
  }))
  const rights: RightsSummary = {
    overview: fallback.overview,
    bullets: fallback.bullets.map((text, index) => ({
      text,
      sourceTitle: fallback.steps[index % fallback.steps.length]?.sourceTitle,
      sourceUrl: fallback.steps[index % fallback.steps.length]?.url,
    })),
    origin: 'heuristic',
    caveat: RIGHTS_CAVEAT,
  }
  return {
    pathwayId: fallback.id,
    title: fallback.title,
    summary: fallback.summary,
    primaryUrl: fallback.url,
    rights,
    sourceSnippets,
    featuredTools: [],
    steps: fallback.steps,
    related: [],
    disclaimer: RIGHTS_CAVEAT,
  }
}

/** Domains to query for this session / frame set. */
export function activeDomains(session: SessionState, frames: LegalFrame[] = []): WikiDomainId[] {
  const domains = new Set<WikiDomainId>()
  const matterDomain = MATTER_TO_DOMAIN[session.matterType]
  if (matterDomain) domains.add(matterDomain)

  for (const f of frames) {
    for (const [prefix, domain] of Object.entries(FRAME_PREFIX_TO_DOMAIN)) {
      if (f.id.startsWith(prefix)) domains.add(domain)
    }
  }

  const blob = normaliseLayText(session.rawInputs.join(' ')).toLowerCase()
  if (/\bilr\b|visa|asylum|home office|deport/.test(blob)) domains.add('immigration')
  if (/landlord|tenant|evict|mould|homeless|\brents?\b|tenancy|section\s*21|flatmate|housemate/.test(blob))
    domains.add('housing')
  // Employment domain: require real workplace dispute cues — not bare “employed as…” / “employer travel”
  const employmentDomain =
    /\b(dismiss|fired|sacked|redundan|unfair dismiss|constructive dismiss|unpaid wages|holiday (?:hours|pay)|employment tribunal|acas|pregnant|maternity)\b/i.test(
      blob,
    ) ||
    (/\b(manager|supervisor|boss|line manager)\b/i.test(blob) &&
      /\b(holiday|shift|hours|appointment|drinking water|wage|pay|grievance)\b/i.test(blob))
  const antiEmploymentBleed =
    /\b(insurer|insurance (?:company|claim|policy)|festival|day ticket|wheelchair|airport)\b/i.test(blob) &&
    !/\b(dismiss|sacked|fired|redundan|holiday hours|holiday pay)\b/i.test(blob)
  if (employmentDomain && !antiEmploymentBleed) domains.add('employment')
  if (/debt|bailiff|ccj|creditor|mortgage|repossess|universal credit|\bpip\b|deprivation of capital/.test(blob) && !/\b(festival|day ticket|concert)\b/i.test(blob))
    domains.add('debt')
  if (isBenefitsRulesStory(blob)) {
    domains.add('debt')
  }
  const familyDomain =
    /\b(divorce|custody|child arrangement|domestic abuse|inherit|probate|trust fund|\bctf\b)\b/i.test(blob) ||
    (/\b(\d+\s*year\s*old|my (?:sons?|daughters?|kids?|children|child))\b/i.test(blob) &&
      /\b(my ex|ex[- ]?(?:partner|wife|husband)|his mum|her boyfriend|boyfriend'?s kid)\b/i.test(blob))
  if (familyDomain) domains.add('family')
  // Bare “her house” must not add housing when this is a parental dispute
  if (familyDomain && !/landlord|tenant|evict|tenancy|\brents?\b|section\s*21/.test(blob)) {
    domains.delete('housing')
  }
  // Damaged belongings / sue between parents → also pull consumer / courts wiki
  if (
    /\b(threw|broke|broken|damaged|destroyed|smashed)\b/.test(blob) &&
    /\b(sue|replacement|get (?:it|them) (?:back|fixed)|switch|console|toy|gift|belongings)\b/.test(blob)
  ) {
    domains.add('consumer')
  }
  if (
    (/refund|faulty|trader|warranty|consumer|used car|bought .{0,20}(?:car|vehicle)|dealer|garage|fault codes?|insurer|insurance|festival|day ticket|wheelchair|airport|accessibility/.test(
      blob,
    ) ||
      session.matterType === 'consumer') &&
    !(/\b(car\s*park|parking|pcn|popla|neighbour|neighbor|driveway|car\s*port|carport)\b/.test(blob) &&
      !/\b(used car|dealer|fault codes?)\b/.test(blob)) &&
    !isBenefitsRulesStory(blob)
  ) {
    domains.add('consumer')
  }
  if (/\b(car\s*park|parking (?:fine|ticket|charge)|pcn|popla|private parking)\b/.test(blob)) {
    domains.add('consumer')
  }
  if (/sentenc|arrest|police|criminal|offence|magistrates|cps|fraud|theft|assault|confiscat|seiz/.test(blob))
    domains.add('crime')

  if (session.ukTaxonomyPackId) {
    if (/mortgage/.test(session.ukTaxonomyPackId)) domains.add('debt')
    if (/joint_tenancy|deposit|possession/.test(session.ukTaxonomyPackId)) domains.add('housing')
    if (/police|crime/.test(session.ukTaxonomyPackId)) domains.add('crime')
    if (/trusts|inheritance/.test(session.ukTaxonomyPackId)) domains.add('family')
    if (/pregnancy|unfair_dismissal/.test(session.ukTaxonomyPackId)) domains.add('employment')
  }

  if (domains.size === 0) return []
  return [...domains]
}

function sessionText(session: SessionState): string {
  return buildRetrievalText(session)
}

/** Hard filter: UK-wide pages always ok; nation-tagged pages only for matching session. */
export function jurisdictionAllows(pageJurisdiction: string, sessionJurisdiction: Jurisdiction): boolean {
  const pj = pageJurisdiction || 'UK'
  if (pj === 'UK' || pj === 'UK-wide' || pj === 'Unknown') return true
  if (sessionJurisdiction === 'Unknown') return true
  return pj === sessionJurisdiction
}

function scorePage(page: WikiPage, text: string, frameIds: string[], domainId?: WikiDomainId): number {
  let score = 0
  if (page.id.includes('sentinel')) return -1000

  const overlap = page.frameIds.filter((f) => frameIds.includes(f))
  score += overlap.length * 12
  if (page.kind === 'pathway' && overlap.length) score += 10
  if (page.kind === 'entity' && overlap.length) score += 6
  // Prefer concrete pathways over folder-dump topics (e.g. "work", "debt")
  if (page.kind === 'topic' && /^(work|employment|law|debt|benefits|money|housing|family)$/i.test(page.title.trim())) {
    score -= 8
  }

  score += AUTHORITY_BOOST[page.authority || 'secondary'] || 0

  if (
    domainId &&
    domainId !== 'immigration' &&
    IMM_CITIZENSHIP_URL_NOISE.test(page.primaryUrl || '')
  ) {
    score -= 40
  }

  for (const kw of page.keywords) {
    if (kw.length < 3) continue
    if (text.includes(kw)) score += kw.length > 5 ? 2 : 1
  }
  for (const sid of page.sourceIds) {
    if (
      text.includes(sid.replace(/-/g, ' ')) ||
      sid.split('-').some((w) => w.length > 4 && text.includes(w))
    ) {
      score += 2
    }
  }

  // Domain-agnostic story boosts
  if (/refus|reject|appeal|review|tribunal/.test(text) && /challenge|review|tribunal|appeal/.test(page.id + page.title.toLowerCase())) {
    score += 5
  }
  if (/evict|possession|section 21|lock.?out/.test(text) && /evict|possession|section/.test(page.id + page.title.toLowerCase())) {
    score += 5
  }
  if (/dismiss|fired|redundan/.test(text) && /dismiss|redundan|unfair/.test(page.id + page.title.toLowerCase())) {
    score += 5
  }
  if (/bailiff|ccj|debt/.test(text) && /bailiff|ccj|debt|enforcement/.test(page.id + page.title.toLowerCase())) {
    score += 5
  }
  if (
    /refund|faulty|consumer/.test(text) &&
    /refund|faulty|consumer|trader/.test(page.id + page.title.toLowerCase()) &&
    !(isPrivateParkingStory(text) && !isUsedCarPurchaseStory(text) && /used.?car|faulty.?goods|car/.test(page.id + page.title.toLowerCase()))
  ) {
    score += 4
  }
  if (
    isPrivateParkingStory(text) &&
    /parking|pcn|popla|ticket/.test(page.id + page.title.toLowerCase() + (page.primaryUrl || ''))
  ) {
    score += 10
  }
  if (
    isPrivateParkingStory(text) &&
    !isUsedCarPurchaseStory(text) &&
    /used.?car|faulty.?goods|buying.?a.?used.?car/.test(page.id + page.title.toLowerCase())
  ) {
    score -= 40
  }
  if (
    isLeaseholdFireSafetyAlterationStory(text) &&
    /homeless/.test(page.id + page.title.toLowerCase())
  ) {
    score -= 45
  }
  if (
    isLeaseholdFireSafetyAlterationStory(text) &&
    /lease|fire|alter|possession|deposit|tenancy|shared/.test(page.id + page.title.toLowerCase())
  ) {
    score += 8
  }
  if (
    isBenefitsRulesStory(text) &&
    /faulty.?goods|refund|trader|consumer rights/.test(page.id + page.title.toLowerCase())
  ) {
    score -= 45
  }
  if (
    isBenefitsRulesStory(text) &&
    /benefit|universal credit|pip|money|debt.?solution|breathing/.test(
      page.id + page.title.toLowerCase(),
    )
  ) {
    score += 14
  }
  if (
    isVictimCommunicationsHarassmentStory(text) &&
    /if.?accused|accused|sentencing/.test(page.id + page.title.toLowerCase())
  ) {
    score -= 45
  }
  if (
    isVictimCommunicationsHarassmentStory(text) &&
    /victim|witness|harass|stalk|report/.test(page.id + page.title.toLowerCase())
  ) {
    score += 16
  }
  if (/\bilr\b|indefinite leave|settlement|settled/.test(text) && /settlement|ilr|indefinite|settled/.test(page.id)) {
    score += 6
  }
  if (/asylum|refugee|scared to go back|protect/.test(text) && /asylum|protect|refugee/.test(page.id + page.title.toLowerCase())) {
    score += 6
  }
  if (/adviser|solicitor|regulated|near me/.test(text) && /adviser|solicitor/.test(page.id)) score += 5

  return score
}

function toHit(page: WikiPage, score: number, domainId: WikiDomainId): WikiHit {
  return {
    id: page.id,
    kind: page.kind,
    title: page.title,
    topic: page.kind,
    description: page.snippet,
    sourceUrl: page.primaryUrl,
    score,
    frameIds: page.frameIds,
    jurisdiction: page.jurisdiction,
    contradictions: page.contradictions,
    sourceIds: page.sourceIds,
    sourceUrls: page.sourceUrls,
    domainId,
    authority: page.authority,
  }
}

async function scoreDomain(
  domain: WikiDomainId,
  session: SessionState,
  frameIds: string[],
): Promise<{ page: WikiPage; score: number; domainId: WikiDomainId }[]> {
  const catalogue = await loadWiki(domain)
  const text = sessionText(session)
  return catalogue.pages
    .filter((p) => p.kind !== 'index')
    .filter((p) => jurisdictionAllows(p.jurisdiction, session.jurisdiction))
    .map((p) => ({ page: p, score: scorePage(p, text, frameIds, domain), domainId: domain }))
    .filter((x) => x.score > 0 && x.page.primaryUrl)
}

/**
 * Per-frame wiki lookup across active domains.
 */
export async function matchWikiForFrames(
  session: SessionState,
  frames: LegalFrame[],
  limit = 6,
): Promise<WikiHit[]> {
  const domains = activeDomains(session, frames)
  if (domains.length === 0) return []

  const frameIds = frames.length
    ? frames.map((f) => f.id)
    : [`${domains[0] === 'immigration' ? 'imm' : domains[0].slice(0, 4)}-general`]

  const scoredArrays = await Promise.all(domains.map((d) => scoreDomain(d, session, frameIds)))
  const scored = scoredArrays.flat().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aw = AUTHORITY_BOOST[a.page.authority || 'secondary'] || 0
    const bw = AUTHORITY_BOOST[b.page.authority || 'secondary'] || 0
    return bw - aw
  })

  const hits: WikiHit[] = []
  const seen = new Set<string>()

  for (const fid of frameIds) {
    const row = scored.find(
      (x) => x.page.frameIds.includes(fid) && !seen.has(x.page.id) && !x.page.id.includes('sentinel'),
    )
    if (row) {
      seen.add(row.page.id)
      hits.push(toHit(row.page, row.score, row.domainId))
    }
    if (hits.length >= limit) break
  }

  for (const row of scored) {
    if (hits.length >= limit) break
    if (seen.has(row.page.id) || row.page.id.includes('sentinel')) continue
    seen.add(row.page.id)
    hits.push(toHit(row.page, row.score, row.domainId))
  }

  return hits
}

/**
 * OSLAW research: match a pathway, rank its linked sources against the story,
 * then emit a practical course of action from the pathway playbook.
 * Not legal advice.
 */
export async function matchOslawCourse(
  session: SessionState,
  frames: LegalFrame[],
  limit = 3,
): Promise<OslawCourse | null> {
  const text = normaliseLayText(sessionText(session))
  const leadFallback = buildLeadOslawFallback(text)
  if (leadFallback) return leadFallback

  const domains = activeDomains(session, frames)
  if (domains.length === 0) return null

  const frameIds = frames.length
    ? frames.map((f) => f.id)
    : [`${domains[0] === 'immigration' ? 'imm' : domains[0].slice(0, 4)}-general`]

  const parkingOnly = isPrivateParkingStory(text) && !isUsedCarPurchaseStory(text)
  const leaseFireOnly = isLeaseholdFireSafetyAlterationStory(text)
  const benefitsOnly = isBenefitsRulesStory(text)
  const victimHarassment = isVictimCommunicationsHarassmentStory(text)
  const scoredArrays = await Promise.all(domains.map((d) => scoreDomain(d, session, frameIds)))

  let scored = scoredArrays
    .flat()
    .map((row) => ({
      ...row,
      score: row.score + (row.page.kind === 'pathway' ? 18 : row.page.kind === 'topic' ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)

  if (parkingOnly) {
    const withoutUsedCar = scored.filter((x) => {
      const blob = `${x.page.id} ${x.page.title} ${x.page.primaryUrl}`.toLowerCase()
      return !/used.?car|buying.?a.?used.?car|problem-with-a-used-car|decision-trees\/problem-with-a-used-car|faulty.?goods/.test(
        blob,
      )
    })
    // Prefer a non-car pathway when available; otherwise skip wiki course so Answer pack owns parking.
    if (withoutUsedCar.some((x) => x.page.kind === 'pathway' && x.page.primaryUrl)) {
      scored = withoutUsedCar
    } else {
      return null
    }
  }

  if (leaseFireOnly) {
    const withoutHomeless = scored.filter(
      (x) => !/homeless/.test(`${x.page.id} ${x.page.title}`.toLowerCase()),
    )
    if (withoutHomeless.length) scored = withoutHomeless
  }

  if (benefitsOnly) {
    const withoutConsumerGoods = scored.filter((x) => {
      const blob = `${x.page.id} ${x.page.title}`.toLowerCase()
      return !/faulty.?goods|refund.?cancel|trader.?practices/.test(blob)
    })
    if (withoutConsumerGoods.length) scored = withoutConsumerGoods
  }

  if (victimHarassment) {
    const withoutAccused = scored.filter(
      (x) => !/if.?accused|pathway-if-accused|sentencing/.test(`${x.page.id} ${x.page.title}`.toLowerCase()),
    )
    if (withoutAccused.length) scored = withoutAccused
  }

  const pathways = scored.filter((x) => x.page.kind === 'pathway' && x.page.primaryUrl)
  // Benefits: prefer Money/Benefits topic when it outranks debt pathways after filters
  let primary =
    benefitsOnly
      ? scored.find(
          (x) =>
            x.page.primaryUrl &&
            /benefit|universal credit|money.?benefits/i.test(`${x.page.id} ${x.page.title}`),
        ) ??
        pathways[0] ??
        scored.find((x) => x.page.primaryUrl)
      : pathways[0] ?? scored.find((x) => x.page.primaryUrl)
  if (!primary) return null

  if (parkingOnly && /used.?car|faulty.?goods/i.test(`${primary.page.id} ${primary.page.title}`)) {
    return null
  }
  if (leaseFireOnly && /homeless/i.test(`${primary.page.id} ${primary.page.title}`)) {
    return null
  }
  if (victimHarassment && /if.?accused|accused/i.test(`${primary.page.id} ${primary.page.title}`)) {
    primary =
      pathways.find((x) => /victim|witness/i.test(`${x.page.id} ${x.page.title}`)) ?? primary
    if (/if.?accused|accused/i.test(`${primary.page.id} ${primary.page.title}`)) return null
  }

  const page = primary.page
  const domainId = primary.domainId
  const catalogue = await loadWiki(domainId)
  const rankedSources = rankPathwaySources(page, text)
  const topics = linkedTopicPages(page, catalogue)
  const steps = synthesizeStepsFromWiki(page, catalogue, session, rankedSources)
  const featuredTools = featuredToolsFromWiki(page, catalogue, session, domainId)

  const snippetUrls = [
    ...featuredTools.map((t) => t.url),
    ...topics.map((t) => t.primaryUrl),
    ...rankedSources.map((s) => s.url),
  ]
  const sourceSnippets = await loadSourceSnippets(snippetUrls, 6)

  const rights = page.oslawRightsOverview
    ? buildRightsFromWiki(page, topics, sourceSnippets)
    : buildHeuristicRightsSummary(page.id, sourceSnippets)

  // Ensure at least one linked step uses the pathway primary
  if (!steps.some((s) => s.url === page.primaryUrl) && page.primaryUrl) {
    const rightsish = steps.find((s) => /rights|orient|lead|check/i.test(s.id + s.label))
    if (rightsish && !rightsish.url) {
      rightsish.url = page.primaryUrl
      rightsish.sourceTitle = titleFromUrl(page.primaryUrl)
    }
  }

  const related = [
    ...scored.filter((x) => x.page.kind === 'topic' && x.page.primaryUrl && /letter|complain|repair|refund|car|deposit|notice/i.test(x.page.title + x.page.id)),
    ...scored.filter((x) => x.page.kind === 'pathway' && x.page.id !== page.id && x.page.primaryUrl),
  ]
    .filter((x, i, arr) => arr.findIndex((y) => y.page.id === x.page.id) === i)
    .slice(0, limit)
    .map((x) => ({
      title: x.page.title,
      url: x.page.primaryUrl,
      kind: x.page.kind,
    }))

  return {
    pathwayId: page.id,
    title: page.title,
    summary: page.snippet || page.title,
    domainId: primary.domainId,
    authority: page.authority,
    primaryUrl: page.primaryUrl,
    rights,
    sourceSnippets,
    featuredTools,
    steps,
    related,
    disclaimer:
      'OSLAW surfaces open / official wiki pathways only. It is not legal advice and does not replace a regulated adviser.',
  }
}

type RankedSource = { url: string; title: string; score: number }

function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    const slug = path.split('/').filter(Boolean).pop() || 'Open guidance'
    const cleaned = slug.replace(/-/g, ' ').replace(/\.(html?|php)$/i, '')
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  } catch {
    return 'Open guidance'
  }
}

function rankPathwaySources(page: WikiPage, text: string): RankedSource[] {
  const urls = [...new Set([page.primaryUrl, ...(page.sourceUrls || [])].filter(Boolean))]
  const noise = /energy|boiler|insulation|meter|solid-wall|citizenship|visa|passport/i
  const storyBoosts: [RegExp, number][] = [
    [/\bcar\b(?!\s*park)|(?:used car)|(?:\bvehicle\b)|dealer|garage|mot\b|battery|fault codes?/i, 8],
    [/warrant|guarante/i, 5],
    [/refund|cancel|money back/i, 5],
    [/landlord|tenant|mould|evict|deposit|homeless/i, 5],
    [/dismiss|employer|wages|acas|tribunal/i, 5],
  ]

  return urls
    .map((url) => {
      const blob = `${url} ${titleFromUrl(url)}`.toLowerCase()
      let score = 1
      if (url === page.primaryUrl) score += 2
      for (const [re, boost] of storyBoosts) {
        if (re.test(text) && re.test(blob)) score += boost
      }
      // Token overlap between story and URL slug
      for (const tok of text.split(/[^a-z0-9]+/).filter((t) => t.length > 3)) {
        if (blob.includes(tok)) score += 1
      }
      if (noise.test(blob) && !noise.test(text)) score -= 12
      return { url, title: titleFromUrl(url), score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** Legacy-compatible name. */
export async function matchImmigrationWiki(
  session: SessionState,
  frames: LegalFrame[],
  limit = 6,
): Promise<WikiHit[]> {
  return matchWikiForFrames(session, frames, limit)
}

export function wikiHitsToBriefSources(hits: WikiHit[]): BriefSource[] {
  // Prefer primary authority when ordering citations
  const ordered = [...hits].sort((a, b) => {
    const aw = AUTHORITY_BOOST[a.authority || 'secondary'] || 0
    const bw = AUTHORITY_BOOST[b.authority || 'secondary'] || 0
    return bw - aw
  })
  return ordered.map((h) => ({
    title: h.title,
    url_or_id: h.sourceUrl || h.sourceIds[0] || h.id,
    jurisdiction: h.jurisdiction,
    snippet: h.description.slice(0, 200),
  }))
}

export function wikiHitsToSignposts(
  hits: WikiHit[],
): { label: string; type: 'info' | 'clinic' | 'solicitor' | 'emergency'; url: string }[] {
  return hits
    .filter((h) => h.sourceUrl)
    .map((h) => ({
      label: h.title,
      type: /adviser|solicitor/.test(h.id + h.title.toLowerCase()) ? ('solicitor' as const) : ('info' as const),
      url: h.sourceUrl,
    }))
}

/** Assign sources onto each frame for solicitor brief issues. */
export async function sourcesByFrame(
  session: SessionState,
  frames: LegalFrame[],
  perFrame = 3,
): Promise<Record<string, BriefSource[]>> {
  const domains = activeDomains(session, frames)
  const text = sessionText(session)
  const out: Record<string, BriefSource[]> = {}

  const catalogues = await Promise.all(domains.map((d) => loadWiki(d)))
  const pages = catalogues.flatMap((c, i) =>
    c.pages.map((p) => ({ page: p, domainId: domains[i] })),
  )

  for (const frame of frames) {
    const scored = pages
      .filter(({ page: p }) => p.kind !== 'index')
      .filter(({ page: p }) => jurisdictionAllows(p.jurisdiction, session.jurisdiction))
      .filter(({ page: p }) => !p.id.includes('sentinel'))
      .map(({ page: p, domainId }) => ({
        page: p,
        score: scorePage(p, text, [frame.id], domainId),
      }))
      .filter((x) => x.score > 0 && x.page.primaryUrl)
      .sort((a, b) => b.score - a.score)
      .slice(0, perFrame)

    out[frame.id] = scored.map((x) => ({
      title: x.page.title,
      url_or_id: x.page.primaryUrl || x.page.sourceIds[0] || x.page.id,
      jurisdiction: x.page.jurisdiction,
      snippet: x.page.snippet.slice(0, 200),
    }))
  }
  return out
}

export async function wikiInfo(domain: WikiDomainId = 'immigration') {
  const catalogue = await loadWiki(domain)
  return {
    name: catalogue.collection,
    domainId: (catalogue.domainId || domain) as WikiDomainId,
    pageCount: catalogue.pageCount,
    articleCount: catalogue.articleCount,
    compiledAt: catalogue.compiledAt,
    pattern: catalogue.pattern,
  }
}

export async function wikiInfoForSession(session: SessionState, frames: LegalFrame[] = []) {
  const domains = activeDomains(session, frames)
  const infos = await Promise.all(domains.map((d) => wikiInfo(d)))
  const articleCount = infos.reduce((n, i) => n + i.articleCount, 0)
  const pageCount = infos.reduce((n, i) => n + i.pageCount, 0)
  return {
    name: infos.map((i) => i.name).join(' + '),
    domains,
    articleCount,
    pageCount,
    compiledAt: infos[0]?.compiledAt,
    pattern: 'llm-wiki-domain',
  }
}
