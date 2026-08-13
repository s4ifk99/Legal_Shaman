/**
 * OSLAW rights summaries — grounded in matched wiki / catalogue sources.
 * Heuristic text is pathway-level open guidance; LLM may refine from source snippets.
 * Never claim case-specific entitlement.
 */

export type RightsBullet = {
  text: string
  sourceTitle?: string
  sourceUrl?: string
}

export type RightsSummary = {
  /** Short plain-language overview of rights usually covered by the matched sources */
  overview: string
  bullets: RightsBullet[]
  /** How the summary was produced */
  origin: 'heuristic' | 'llm' | 'wiki'
  /** Caveat always shown */
  caveat: string
}

/** Pathway-keyed rights overview + bullets (open guidance, not advice). */
export const OSLAW_RIGHTS: Record<
  string,
  { overview: string; bullets: string[] }
> = {
  'pathway-faulty-goods': {
    overview:
      'When you buy goods from a trader in the UK, the Consumer Rights Act 2015 usually requires satisfactory quality, fitness for purpose, and match to description. For used cars, remedies follow a ladder: short-term reject (about 30 days) → repair/replacement → final reject or price reduction after one failed repair. Citizens Advice frames trader vs private seller and process; statute sections on legislation.gov.uk are decisive for repair/reject/deduction-for-use.',
    bullets: [
      'Goods must generally be of satisfactory quality, as described, and fit for the purpose made known to the trader (CRA ss.9–11).',
      'Short-term right to reject is usually within 30 days of delivery; a repair request can pause that clock (CRA s.22).',
      'After that, repair or replacement within a reasonable time without significant inconvenience is often first (CRA s.23).',
      'After one failed repair/replacement, you may choose price reduction or final reject — not both (CRA s.24(5)–(7)).',
      'On final reject of a motor vehicle, a use deduction may apply even within 6 months (CRA s.24(10)).',
      'Within 6 months, a lack of conformity is generally treated as present at delivery unless the trader proves otherwise (CRA s.19).',
      'A warranty sits alongside CRA rights — it does not usually replace them.',
    ],
  },
  'pathway-refund-cancel': {
    overview:
      'Open refund and cancellation guidance covers when you can get money back or end a contract — including cooling-off rights for many distance purchases, and separate rules when goods or services are faulty.',
    bullets: [
      'Distance / online purchases often have a cooling-off period where you can cancel without giving a reason (check the guidance for exceptions).',
      'Faulty goods or poor service may support a refund, repair, or replacement route instead of (or as well as) cooling-off.',
      'Keep proof of purchase and any cancel / refund requests you already sent.',
    ],
  },
  'pathway-trader-practices': {
    overview:
      'Open sources on trader conduct cover unfair contract terms, mis-selling, and what you can do when a trader’s practices look unfair — usually starting with a written complaint, then reporting or ADR routes.',
    bullets: [
      'Unfair terms may not be enforceable in the way the trader claims — check the open unfair-terms guidance.',
      'Mis-selling and aggressive practices have separate complaint and reporting pathways in CAB / AdviceNow materials.',
      'A dated written complaint creates the trail most escalation routes expect.',
    ],
  },
  'pathway-disrepair': {
    overview:
      'Housing repair guidance usually says landlords must keep the structure, exterior, and key installations (like heating and sanitation) in repair. Tenants are expected to report problems; if nothing happens, council inspection and further steps are covered in open sources.',
    bullets: [
      'Landlords generally must repair structure, exterior, and installations for water, gas, electricity, heating, and sanitation.',
      'Report disrepair in writing and keep copies, photos, and dates.',
      'If the landlord does not act, open guidance covers asking the council to inspect and further enforcement options.',
    ],
  },
  'pathway-possession-eviction': {
    overview:
      'Possession and eviction pathways in open sources turn on what notice or claim you received (for example section 21 or section 8) and whether process rules were followed. Court dates should not be ignored.',
    bullets: [
      'Different notices and claims have different validity and response rules — match yours in the open possession guidance.',
      'Illegal eviction / lock-out is treated as urgent in open housing sources.',
      'Homelessness prevention duties may apply if you are at risk of losing your home.',
    ],
  },
  'pathway-deposit-rent': {
    overview:
      'Open deposit guidance centres on whether a tenancy deposit was protected in an authorised scheme and how to challenge unfair deductions through the scheme’s dispute process.',
    bullets: [
      'Most tenancy deposits must be protected in a government-authorised scheme.',
      'Scheme dispute processes are the usual route for contested deductions.',
      'Keep check-in / check-out evidence and the deposit certificate details.',
    ],
  },
  'pathway-homelessness': {
    overview:
      'Homelessness open guidance covers how to apply to your local authority and what duties may arise when you are homeless or threatened with homelessness.',
    bullets: [
      'You can approach your local authority homelessness team for help.',
      'Take ID, housing papers, and evidence of why you left or may lose your home.',
      'Duties differ by nation and by whether you are in priority need — check the nation-specific open guidance.',
    ],
  },
  'pathway-dismissal': {
    overview:
      'Employment dismissal guidance commonly covers unfair and wrongful dismissal, qualifying service, and the need for ACAS Early Conciliation before most tribunal claims.',
    bullets: [
      'Unfair dismissal claims usually need qualifying service (with important exceptions).',
      'ACAS Early Conciliation is typically required before an employment tribunal claim.',
      'Strict time limits apply — open ACAS / CAB sources explain how they are counted.',
    ],
  },
  'pathway-wages': {
    overview:
      'Open pay guidance covers unpaid wages, holiday pay, and national minimum wage issues, and how to challenge underpayment.',
    bullets: [
      'You are generally entitled to be paid what your contract and the law require, including holiday pay where it applies.',
      'Payslips, contracts, and hours records are the core evidence open sources ask for.',
      'ACAS and CAB materials describe complaint and tribunal pathways if pay is withheld.',
    ],
  },
}

export const OSLAW_RIGHTS_GENERIC: { overview: string; bullets: string[] } = {
  overview:
    'The matched open wiki pathway collects official and advice-org guidance for this issue type. The points below are what those sources typically cover — not a decision on your specific case.',
  bullets: [
    'Read the lead open source for the rights and remedies it describes.',
    'Compare a second open source on the same pathway before you act.',
    'Use written complaints and keep evidence — most escalation routes expect a paper trail.',
  ],
}

export const RIGHTS_CAVEAT =
  'This is a research summary of open / official guidance matched to your situation. It is not legal advice and does not decide what you are entitled to.'
