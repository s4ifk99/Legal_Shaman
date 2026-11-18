/**
 * Plain-language process options grounded in GOV.UK civil process guidance.
 * Shown as explanation — not as bare links.
 */
import type { DisputeKind } from "@/lib/cases/dispute-context";

export type ExplainedOption = {
  id: string;
  title: string;
  explanation: string;
  /** Official guidance URL — shown as a hyperlinked (Source) in chat. */
  url?: string;
};

export type ProcessGuide = {
  kind: DisputeKind;
  processName: string;
  awarenessQuestion: string;
  /** What the process is, in calm plain English */
  processOverview: string;
  options: ExplainedOption[];
  financingNotes: ExplainedOption[];
};

const DIVORCE: ProcessGuide = {
  kind: "divorce",
  processName: "divorce",
  awarenessQuestion:
    "Do you already know how divorce usually works in England and Wales, or would you like me to explain the options first?",
  processOverview:
    "In England and Wales you can apply for divorce after you’ve been married at least a year, if the relationship has permanently broken down. It usually takes at least about seven months. You can apply together (joint) or on your own (sole). Arrangements for children and for money or property are separate from the divorce paperwork itself.",
  options: [
    {
      id: "joint",
      title: "Apply together (joint)",
      explanation:
        "If you both agree to divorce and you feel safe, you can apply jointly. You both confirm each stage. If the other person stops responding, you can usually continue alone.",
      url: "https://www.gov.uk/divorce/before-you-apply",
    },
    {
      id: "sole",
      title: "Apply on your own (sole)",
      explanation:
        "Use a sole application if they don’t agree, or you don’t think they’ll cooperate. You still confirm each stage yourself.",
      url: "https://www.gov.uk/divorce/before-you-apply",
    },
    {
      id: "children",
      title: "Children arrangements",
      explanation:
        "Where children live, how much time they spend with each parent, and child maintenance are decided separately. Many people agree without court; mediation can help first.",
      url: "https://www.gov.uk/looking-after-children-divorce",
    },
    {
      id: "money",
      title: "Money and property",
      explanation:
        "You can agree how to divide the home, pensions, and savings. To make an agreement binding you usually need a court-approved consent order. Complex assets often need specialist help.",
      url: "https://www.gov.uk/money-property-when-relationship-ends",
    },
    {
      id: "mediation",
      title: "Agree without a hearing where you can",
      explanation:
        "If you can agree children and money, you often avoid contested hearings. Family mediation is a common next step before court applications.",
      url: "https://www.gov.uk/try-mediation",
    },
  ],
  financingNotes: [
    {
      id: "legal_aid",
      title: "Legal aid",
      explanation:
        "Legal aid for divorce is limited. It is more often available where there is evidence of domestic abuse, or for certain child cases. Worth checking if money is tight.",
    },
    {
      id: "help_fees",
      title: "Help with court fees",
      explanation:
        "The divorce application fee can sometimes be reduced or waived if you’re on a low income or certain benefits.",
    },
    {
      id: "free_advice",
      title: "Free advice first",
      explanation:
        "Law centres, family clinics, and Advicenow-style guides can explain paperwork before you pay a solicitor.",
    },
    {
      id: "fixed_fee",
      title: "Fixed-fee or private help",
      explanation:
        "Useful for consent orders or complex pensions/property once you know what you want. Don’t rush to pay before free checks.",
    },
  ],
};

const HOUSING: ProcessGuide = {
  kind: "housing",
  processName: "housing dispute",
  awarenessQuestion:
    "Do you already know the usual steps for this kind of housing problem, or shall I explain your options?",
  processOverview:
    "Housing rights depend on whether you’re a private tenant, social tenant, or homeowner. Deadlines and notices matter. Free advice often comes before court.",
  options: [
    {
      id: "check_status",
      title: "Confirm your tenancy or ownership",
      explanation:
        "Your rights differ for private renting, council/housing association, and ownership. That changes who you complain to and what notices mean.",
      url: "https://www.gov.uk/private-renting",
    },
    {
      id: "evidence",
      title: "Gather evidence early",
      explanation:
        "Keep the tenancy, notices, photos, repair reports, and a dated list of what happened.",
      url: "https://www.gov.uk/private-renting",
    },
    {
      id: "complain",
      title: "Raise it in writing",
      explanation:
        "Write to the landlord or agent with what you want and a clear deadline before escalating.",
      url: "https://www.gov.uk/private-renting/repairs",
    },
    {
      id: "escalate",
      title: "Escalation routes",
      explanation:
        "Depending on the issue: deposit scheme, local council (disrepair/hazards), ombudsman, or court. Free advice can map the right door.",
      url: "https://www.gov.uk/eviction-procedures",
    },
  ],
  financingNotes: [
    {
      id: "legal_aid",
      title: "Legal aid",
      explanation:
        "Housing legal aid can apply in serious cases such as homelessness risk or severe disrepair — eligibility still depends on your means and the issue.",
    },
    {
      id: "free_advice",
      title: "Free advice",
      explanation:
        "Shelter, housing law centres, and duty schemes often help before you pay privately.",
    },
  ],
};

const EMPLOYMENT: ProcessGuide = {
  kind: "employment",
  processName: "work dispute",
  awarenessQuestion:
    "Do you already know the usual workplace dispute steps, or shall I explain your options?",
  processOverview:
    "Many workplace issues start with internal grievance or ACAS Early Conciliation before a tribunal. Time limits can be short — often months, not years.",
  options: [
    {
      id: "internal",
      title: "Raise it at work",
      explanation:
        "A written grievance or informal raise with HR can create a record and sometimes fix things without a claim.",
      url: "https://www.gov.uk/raise-grievance-at-work",
    },
    {
      id: "acas",
      title: "ACAS Early Conciliation",
      explanation:
        "Before most tribunal claims you usually contact ACAS. It’s free and can pause time limits while they try to settle.",
      url: "https://www.gov.uk/employment-tribunals/make-a-claim",
    },
    {
      id: "tribunal",
      title: "Employment tribunal",
      explanation:
        "If needed, you can claim for things like unfair dismissal or unpaid wages — but deadlines are strict.",
      url: "https://www.gov.uk/employment-tribunals",
    },
  ],
  financingNotes: [
    {
      id: "free_advice",
      title: "Free advice",
      explanation:
        "ACAS and some unions give free guidance. Civil legal aid for employment is limited (discrimination can be an exception).",
    },
    {
      id: "union",
      title: "Union or insurance",
      explanation:
        "Union membership or legal expenses cover can fund advice without paying privately first.",
    },
  ],
};

const CONSUMER: ProcessGuide = {
  kind: "consumer",
  processName: "consumer problem",
  awarenessQuestion:
    "Do you already know your consumer options, or shall I explain them briefly?",
  processOverview:
    "For faulty goods or poor services you usually complain to the trader first, then use chargeback/section 75 where card payments apply, then ADR or court if needed.",
  options: [
    {
      id: "trader",
      title: "Complain to the trader",
      explanation:
        "State the fault, what you want (repair, replace, refund), and a deadline. Keep copies.",
      url: "https://www.gov.uk/reject-faulty-goods",
    },
    {
      id: "payment",
      title: "Card or finance protection",
      explanation:
        "Credit/debit card and finance routes can sometimes reclaim money when the trader fails.",
      url: "https://www.gov.uk/reject-faulty-goods",
    },
    {
      id: "adr",
      title: "Alternative dispute resolution",
      explanation:
        "Some sectors have free or low-cost schemes before small claims court.",
      url: "https://www.gov.uk/make-court-claim-for-money",
    },
  ],
  financingNotes: [
    {
      id: "free_advice",
      title: "Free advice",
      explanation:
        "Free consumer advice services and Trading Standards routes can check which rights fit before you pay anyone.",
    },
  ],
};

const DEBT: ProcessGuide = {
  kind: "debt",
  processName: "debt problem",
  awarenessQuestion:
    "Do you already know your debt options, or shall I explain them first?",
  processOverview:
    "Priority debts (rent, council tax) need faster attention than credit cards. Free debt advice can map repayment, breathing space, or formal options.",
  options: [
    {
      id: "priority",
      title: "Sort priority debts first",
      explanation:
        "Rent, council tax, and similar can lead to serious enforcement faster than catalogue or card debt.",
      url: "https://www.gov.uk/options-for-paying-off-your-debts",
    },
    {
      id: "budget",
      title: "Budget and contact",
      explanation:
        "A realistic budget and early contact with creditors often beats silence.",
      url: "https://www.gov.uk/options-for-paying-off-your-debts",
    },
    {
      id: "formal",
      title: "Formal options if needed",
      explanation:
        "Free advisers can explain DRO, IVA, or bankruptcy if repayments aren’t realistic — don’t choose these alone.",
      url: "https://www.gov.uk/options-for-paying-off-your-debts/formal-ways-to-clear-your-debt",
    },
  ],
  financingNotes: [
    {
      id: "free_advice",
      title: "Free debt advice",
      explanation:
        "Use free regulated debt advice before paying a private firm to ‘manage’ debt.",
    },
  ],
};

const NEIGHBOUR: ProcessGuide = {
  kind: "neighbour",
  processName: "neighbour dispute",
  awarenessQuestion:
    "Do you already know the usual steps for neighbour disputes, or shall I explain?",
  processOverview:
    "Most neighbour issues start with calm contact and evidence, then mediation or council routes for noise/ASB, before court.",
  options: [
    {
      id: "talk",
      title: "Talk or write first",
      explanation:
        "A polite written note with dates often helps more than an argument at the fence.",
      url: "https://www.gov.uk/how-to-resolve-neighbour-disputes",
    },
    {
      id: "evidence",
      title: "Keep a log",
      explanation:
        "Dates, times, photos, and recordings (where lawful) support any later complaint.",
      url: "https://www.gov.uk/how-to-resolve-neighbour-disputes",
    },
    {
      id: "council",
      title: "Council or mediation",
      explanation:
        "Noise and antisocial behaviour can go to the council; mediation suits boundary/access rows.",
      url: "https://www.gov.uk/report-noise-nuisance-to-council",
    },
  ],
  financingNotes: [
    {
      id: "free_advice",
      title: "Free advice",
      explanation:
        "Council antisocial-behaviour teams and mediation can come before paying a solicitor.",
      url: "https://www.gov.uk/report-antisocial-behaviour",
    },
  ],
};

const BENEFITS: ProcessGuide = {
  kind: "benefits",
  processName: "Universal Credit / benefits claim",
  awarenessQuestion:
    "Do you already know the usual UC challenge steps (mandatory reconsideration, then tribunal), or shall I explain?",
  processOverview:
    "Universal Credit problems usually follow: understand the DWP decision, ask for mandatory reconsideration, then appeal to the First-tier Tribunal if you still disagree. Deadlines are often about a month.",
  options: [
    {
      id: "decision",
      title: "Keep the decision / journal notice",
      explanation:
        "Save the date and reasons — MR and appeal clocks usually run from the decision or MR notice.",
      url: "https://www.gov.uk/universal-credit",
    },
    {
      id: "mr",
      title: "Mandatory reconsideration",
      explanation:
        "Ask DWP to look again before most tribunal appeals. Use your journal or the GOV.UK route.",
      url: "https://www.gov.uk/mandatory-reconsideration",
    },
    {
      id: "appeal",
      title: "Appeal to the tribunal",
      explanation:
        "If the MR notice still disagrees with you, appeal to the First-tier Tribunal (Social Security and Child Support).",
      url: "https://www.gov.uk/appeal-benefit-decision",
    },
    {
      id: "free_help",
      title: "Free benefits advice",
      explanation:
        "Citizens Advice, Advicenow guides, and some law centres help with UC challenges — usually before anyone paid.",
      url: "https://www.citizensadvice.org.uk/benefits/",
    },
  ],
  financingNotes: [
    {
      id: "free_first",
      title: "Free advice first",
      explanation:
        "UC appeals are rarely mainstream legal aid — free advice does most of this work.",
      url: "https://www.gov.uk/legal-aid",
    },
  ],
};

const GENERAL: ProcessGuide = {
  kind: "general",
  processName: "legal situation",
  awarenessQuestion:
    "Do you already know the usual next steps for this kind of problem, or shall I explain your options?",
  processOverview:
    "Most disputes follow a pattern: clarify what happened, gather evidence, use free advice, then escalate only if needed.",
  options: [
    {
      id: "clarify",
      title: "Clarify the problem and goal",
      explanation:
        "Write one sentence on what went wrong and what you want next.",
      url: "https://www.gov.uk/browse/justice",
    },
    {
      id: "evidence",
      title: "Gather evidence",
      explanation:
        "Letters, emails, photos, contracts, and a short timeline.",
      url: "https://www.gov.uk/browse/justice",
    },
    {
      id: "advice",
      title: "Get a free check",
      explanation:
        "A free adviser can confirm which door fits before you pay.",
      url: "https://www.gov.uk/legal-aid",
    },
  ],
  financingNotes: [
    {
      id: "mix",
      title: "Financing mix",
      explanation:
        "Free advice → legal aid check if relevant → insurance/union → fixed-fee only when the ask is clear.",
    },
  ],
};

export function getProcessGuide(kind: DisputeKind): ProcessGuide {
  switch (kind) {
    case "divorce":
      return DIVORCE;
    case "housing":
      return HOUSING;
    case "employment":
      return EMPLOYMENT;
    case "consumer":
      return CONSUMER;
    case "debt":
      return DEBT;
    case "neighbour":
      return NEIGHBOUR;
    case "benefits":
      return BENEFITS;
    default:
      return GENERAL;
  }
}

function sourceSuffix(url?: string | null): string {
  const href = (url || "").trim();
  if (!href.startsWith("http")) return "";
  return ` ([Source](${href}))`;
}

export type OptionExtraNote = {
  text: string;
  url?: string;
};

/**
 * Split options into short chat turns — never one information dump.
 * Financing is intentionally omitted; the flow asks about money separately.
 */
export function formatOptionsMessages(
  guide: ProcessGuide,
  opts: { extras?: OptionExtraNote[] } = {},
): string[] {
  const messages: string[] = [];
  messages.push(guide.processOverview + sourceSuffix(guide.options[0]?.url));

  for (const o of guide.options) {
    messages.push(`${o.title}: ${o.explanation}${sourceSuffix(o.url)}`);
  }

  for (const extra of (opts.extras || []).slice(0, 3)) {
    const text = extra.text.replace(/\s+/g, " ").trim();
    if (text.length < 24) continue;
    // Keep extras short so they stay conversational.
    const clipped = text.length > 220 ? `${text.slice(0, 217).trim()}…` : text;
    messages.push(`${clipped}${sourceSuffix(extra.url)}`);
  }

  messages.push("This is guidance to help you act — not legal advice.");
  return messages;
}

/** Single-string fallback for storage / older callers. */
export function formatOptionsForChat(
  guide: ProcessGuide,
  opts: { includeFinancing?: boolean; wikiExtras?: string[] } = {},
): string {
  const extras = (opts.wikiExtras || []).map((text) => ({ text }));
  return formatOptionsMessages(guide, { extras }).join("\n\n");
}
