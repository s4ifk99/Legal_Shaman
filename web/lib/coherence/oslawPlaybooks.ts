/**
 * OSLAW practical playbooks — FALLBACK when compiled wiki pathways lack OSLAW sections.
 * Primary source is wiki markdown + JSON (see scripts/lib/wiki-oslaw.mjs at compile time).
 */

export type PlaybookStepDef = {
  id: string
  /** Imperative action the person can take */
  label: string
  /** Why / what to look for in the linked open guidance */
  detail: string
  /** Only include when session text matches */
  when?: RegExp
  /** Prefer pathway source URLs matching this */
  prefer?: RegExp
  /** Demote / skip URLs matching this when picking a link */
  avoid?: RegExp
  /** Hard-coded open tool / page (e.g. CAB decision tree) */
  fixedUrl?: string
  fixedTitle?: string
}

/** Featured interactive tools OSLAW can surface (open third-party, not hosted here). */
export type OslawFeaturedTool = {
  id: string
  title: string
  detail: string
  url: string
  when: RegExp
}

export const OSLAW_FEATURED_TOOLS: OslawFeaturedTool[] = [
  {
    id: 'cab-used-car-decision-tree',
    title: 'Citizens Advice: Problem with a used car (decision tree)',
    detail:
      'Interactive open tool — starts with where you bought the car (trader or private seller) and branches to the remedies that usually apply. Often clearer than reading static pages alone.',
    url: 'https://www.citizensadvice.org.uk/decision-trees/problem-with-a-used-car/',
    when: /\bcar\b|vehicle|dealer|garage|mot\b|battery|fault codes?|used car|motor/i,
  },
]

/** Keyed by pathway page id (e.g. pathway-faulty-goods). */
export const OSLAW_PLAYBOOKS: Record<string, PlaybookStepDef[]> = {
  'pathway-faulty-goods': [
    {
      id: 'cab-decision-tree',
      label: 'Run the Citizens Advice used-car decision tree',
      detail:
        'This open interactive tool asks where you bought the car (trader vs private seller) and walks you through repair, rejection, and refund options step by step. Use it first for vehicle disputes.',
      when: /\bcar\b|vehicle|dealer|garage|mot\b|battery|fault codes?|used car/i,
      fixedUrl: 'https://www.citizensadvice.org.uk/decision-trees/problem-with-a-used-car/',
      fixedTitle: 'CAB decision tree — Problem with a used car',
    },
    {
      id: 'evidence',
      label: 'Gather proof of the fault and what was promised',
      detail:
        'Keep receipts or invoices, photos/videos, fault codes, and any messages where the trader or dealer said the problem was fixed.',
    },
    {
      id: 'rights',
      label: 'Read the static “Problem with a used car” rights page',
      detail:
        'Alongside the decision tree, this page summarises when you may have a right to repair, repair costs, or money back — and common exceptions (told about the fault, wear and tear, you caused it).',
      prefer: /problems-with-a-used-car|problem-with-a-used-car/,
      when: /\bcar\b|vehicle|dealer|garage|mot\b|battery|fault codes?/i,
      avoid: /energy|boiler|insulation|meter|decision-trees/,
      fixedUrl: 'https://www.citizensadvice.org.uk/consumer/buying-or-repairing-a-car/problems-with-a-used-car/',
      fixedTitle: 'Problem with a used car — Citizens Advice',
    },
    {
      id: 'rights-general',
      label: 'Check your rights when goods or services are faulty',
      detail:
        'Open guidance covers repair, replacement, and short-term rejection rights under consumer law — use it to see which remedies usually apply.',
      prefer: /buying-or-repairing-a-car\/?$|\/faulty-goods|not-as-described|somethings-gone-wrong-with-a-purchase\/?$/,
      avoid: /energy|boiler|insulation|meter|warranty|guarantee|template-letters|letter-to-complain|decision-trees/,
      when: /^(?!.*\b(car|vehicle|dealer|garage|battery|mot)\b).*/is, // non-car only — car uses pages above
    },
    {
      id: 'warranty',
      label: 'If a warranty or guarantee was offered, follow that route too',
      detail:
        'Warranty claims sit alongside statutory rights — check deadlines, what is covered, and how to claim.',
      prefer: /warranty|guarantee/,
      when: /warrant|guarante|rectif|replaced|repair|dealer|garage|claim/i,
    },
    {
      id: 'car-hub',
      label: 'Browse the wider buying / repairing a car hub',
      detail:
        'Covers used cars, failed repairs, hire purchase, approved garages, and motor-trade associations.',
      prefer: /buying-or-repairing-a-car\/?$/,
      when: /\bcar\b|vehicle|dealer|garage|mot\b|battery|fault codes?/i,
      avoid: /energy|boiler|insulation|meter|decision-trees/,
    },
    {
      id: 'complain',
      label: 'Put a written complaint to the trader or dealer',
      detail:
        'Use an open template letter: state the fault, what you want (repair, replace, or refund), and a clear deadline.',
      prefer: /template-letters|letter-to-complain|faulty-goods/,
      avoid: /energy|boiler|insulation/,
    },
    {
      id: 'trade-body',
      label: 'Ask a motor trade association for help if it is a garage dispute',
      detail:
        'If the garage or dealer is in a trade body, open guidance explains how that complaints route works.',
      prefer: /motor-industry|motor-trade|approved-garage/,
      when: /\bcar\b|vehicle|dealer|garage|mot\b|battery/i,
    },
    {
      id: 'escalate',
      label: 'If they still refuse — refund, ADR, or court pathways',
      detail:
        'Next open options are usually: formal refund/cancellation guidance, alternative dispute resolution, then small claims if needed.',
      prefer: /refund|cancel|chargeback|trader|unfair/,
    },
  ],

  'pathway-refund-cancel': [
    {
      id: 'evidence',
      label: 'Collect proof of purchase and what you asked for',
      detail: 'Order confirmation, payment record, and any cancel / refund requests you already sent.',
    },
    {
      id: 'rights',
      label: 'Check cooling-off and refund rights for your purchase type',
      detail: 'Distance selling, in-store, and services differ — match your situation in the open refund guidance.',
      prefer: /refund|cancel|changed-your-mind|cooling/,
    },
    {
      id: 'complain',
      label: 'Send a clear written refund or cancellation request',
      detail: 'Say what you bought, when, why you want money back, and by when you expect a reply.',
      prefer: /letter|template|refund|cancel/,
    },
    {
      id: 'escalate',
      label: 'Escalate if the trader ignores you',
      detail: 'Chargeback (card), ADR schemes, and court claims are the usual next open pathways.',
      prefer: /trader|unfair|chargeback|court|claim/,
    },
  ],

  'pathway-trader-practices': [
    {
      id: 'evidence',
      label: 'Write down what was said or sold to you',
      detail: 'Ads, quotes, contracts, and messages that show unfair terms or mis-selling.',
    },
    {
      id: 'rights',
      label: 'Check guidance on unfair terms and trader conduct',
      detail: 'Open sources explain when terms may be unfair and how to challenge them.',
      prefer: /unfair|trader|mis-?sell|scam/,
    },
    {
      id: 'complain',
      label: 'Complain to the trader in writing first',
      detail: 'Keep a dated letter or email trail before any escalation.',
      prefer: /letter|complain|template/,
    },
    {
      id: 'escalate',
      label: 'Report or escalate if needed',
      detail: 'Trading Standards / Citizens Advice consumer service and ADR routes are covered in open guidance.',
      prefer: /trader|report|trading|cma/,
    },
  ],

  'pathway-disrepair': [
    {
      id: 'evidence',
      label: 'Record the disrepair (photos, dates, health impact)',
      detail: 'Damp, mould, leaks, heating — note when you reported each problem.',
    },
    {
      id: 'duties',
      label: 'Check what your landlord must repair',
      detail: 'Open guidance sets out landlord repair duties for private and social tenants.',
      prefer: /landlord.*repair|check-if-your-landlord|housing-conditions|disrepair/,
    },
    {
      id: 'report',
      label: 'Report the problem in writing and keep copies',
      detail: 'Use a repairs letter tool or written notice so there is a clear trail.',
      prefer: /letter|repairs-letter|how-get-repairs/,
    },
    {
      id: 'council',
      label: 'Ask the council to inspect if the landlord does nothing',
      detail: 'Environmental health / housing standards routes are covered in open housing guidance.',
      prefer: /council|local-authority|asking-the-council/,
    },
  ],

  'pathway-possession-eviction': [
    {
      id: 'notice',
      label: 'Identify what notice or claim you received',
      detail: 'Section 21, section 8, possession claim, or illegal lock-out each have different open pathways.',
      prefer: /evict|possession|section-21|section-8|notice/,
    },
    {
      id: 'deadline',
      label: 'Check deadlines and whether the notice looks valid',
      detail: 'Open sources explain common validity issues — do not ignore court dates.',
      prefer: /possession|evict|notice|respond/,
    },
    {
      id: 'help',
      label: 'Get urgent housing help if you may lose your home',
      detail: 'Homelessness prevention and duty pathways sit alongside possession guidance.',
      prefer: /homeless|possession|evict/,
    },
  ],

  'pathway-deposit-rent': [
    {
      id: 'scheme',
      label: 'Check whether your deposit is protected',
      detail: 'Deposit protection scheme rules and how to get money back are in open GOV / CAB guidance.',
      prefer: /deposit|protection/,
    },
    {
      id: 'dispute',
      label: 'Use the scheme’s dispute process if deductions are unfair',
      detail: 'Follow the scheme timeline and keep evidence of the property’s condition.',
      prefer: /deposit|dispute|arrears|rent/,
    },
  ],

  'pathway-homelessness': [
    {
      id: 'approach',
      label: 'Approach your local authority homelessness team',
      detail: 'Open guidance covers how to make a homelessness application and what duties may apply.',
      prefer: /homeless|local-authority|council/,
    },
    {
      id: 'evidence',
      label: 'Take proof of where you have been staying and why you left',
      detail: 'ID, tenancy papers, eviction papers, and any violence / safety evidence if relevant.',
    },
  ],

  'pathway-dismissal': [
    {
      id: 'timeline',
      label: 'Write a timeline of the dismissal and any prior warnings',
      detail: 'Dates matter for ACAS Early Conciliation and tribunal limits.',
    },
    {
      id: 'rights',
      label: 'Check unfair / wrongful dismissal rights',
      detail: 'Open ACAS / CAB guidance covers qualifying service and common claim types.',
      prefer: /dismiss|unfair|acas/,
    },
    {
      id: 'acas',
      label: 'Start ACAS Early Conciliation if you may claim',
      detail: 'This is usually required before an employment tribunal claim.',
      prefer: /acas|early-conciliation|tribunal/,
    },
  ],

  'pathway-wages': [
    {
      id: 'records',
      label: 'Collect payslips, contracts, and hours records',
      detail: 'Show what you were owed versus what you were paid.',
    },
    {
      id: 'rights',
      label: 'Check unpaid wages / holiday pay pathways',
      detail: 'Open employment guidance covers how to challenge underpayment.',
      prefer: /wage|pay|holiday|national-minimum/,
    },
  ],
}

/** Fallback when pathway has no dedicated playbook. */
export const OSLAW_GENERIC_PLAYBOOK: PlaybookStepDef[] = [
  {
    id: 'orient',
    label: 'Read the lead open guidance for this pathway',
    detail: 'Start with the pathway’s primary cite — it is the best open overview for this issue type.',
  },
  {
    id: 'evidence',
    label: 'Gather documents and a short timeline',
    detail: 'Dates, letters, notices, photos, and names of the other parties.',
  },
  {
    id: 'act',
    label: 'Take the first action the open guidance recommends',
    detail: 'Usually a written complaint, formal notice, or application — follow the linked source.',
  },
  {
    id: 'escalate',
    label: 'If that fails, use the escalation route in the same guidance',
    detail: 'ADR, tribunal, court, or a regulated adviser — depending on the pathway.',
  },
]
