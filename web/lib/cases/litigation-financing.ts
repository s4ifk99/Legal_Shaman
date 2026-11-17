/**
 * Litigation / claim financing map for Ask the Shaman.
 * Signposts the menu of options; does not promise every claim will find a funder.
 */
import type { DisputeKind } from "@/lib/cases/dispute-context";
import type { FundingPreference } from "@/lib/cases/types";
import {
  buildLegalAidMap,
  type LegalAidLikelihood,
} from "@/lib/cases/legal-aid-knowledge";

export type FinancingRouteId =
  | "free_advice"
  | "legal_aid"
  | "bte_insurance"
  | "union_cover"
  | "ate_insurance"
  | "cfa_dba"
  | "fixed_fee_private"
  | "third_party_funding"
  | "crowdfunding"
  | "broker_marketplace";

export type FinancingLikelihood = "often" | "sometimes" | "rare" | "unlikely";

export type FinancingRoute = {
  id: FinancingRouteId;
  title: string;
  summary: string;
  whenItFits: string;
  likelihood: FinancingLikelihood;
  sourceUrl?: string;
  sourceLabel?: string;
};

export type FinancingContactRole = "funder" | "broker" | "marketplace" | "guidance";

export type FinancingContact = {
  id: string;
  name: string;
  role: FinancingContactRole;
  blurb: string;
  url?: string;
  /** Matter keywords this contact may be relevant for */
  matterHints: string[];
  /** Prefer showing for these dispute kinds */
  kinds?: DisputeKind[];
  /** Only suggest when complexity looks high */
  complexOnly?: boolean;
};

export type FinancingMapResult = {
  complexity: "standard" | "complex";
  complexityReason: string;
  routes: FinancingRoute[];
  contacts: FinancingContact[];
  honestNote: string;
  preferenceHint?: FundingPreference | null;
};

const GOV_PI_INSURANCE =
  "https://www.gov.uk/compensation-accident-claim/check-insurance";
const GOV_PI_SOLICITOR =
  "https://www.gov.uk/compensation-accident-claim/use-solicitor-claims-company";
const CA_AFFORDABLE =
  "https://www.citizensadvice.org.uk/law-and-courts/legal-system/finding-free-or-affordable-legal-help/";
const GOV_LEGAL_AID = "https://www.gov.uk/legal-aid";

/** Official / national financing menu — shown for every claim type. */
export const FINANCING_ROUTES: FinancingRoute[] = [
  {
    id: "free_advice",
    title: "Free advice first",
    summary:
      "Law centres, clinics, Citizens Advice-style help, and national helplines can map rights before you pay.",
    whenItFits: "Almost every claim — especially early on.",
    likelihood: "often",
    sourceUrl: CA_AFFORDABLE,
    sourceLabel: "Citizens Advice",
  },
  {
    id: "legal_aid",
    title: "Civil legal aid",
    summary:
      "Government help for certain problem types if you qualify on scope, means, and merits. Many disputes sit outside scope.",
    whenItFits: "Housing risk, some family/abuse, limited debt/housing-adjacent — not most consumer or employment claims.",
    likelihood: "sometimes",
    sourceUrl: GOV_LEGAL_AID,
    sourceLabel: "GOV.UK",
  },
  {
    id: "bte_insurance",
    title: "Before-the-event (BTE) legal expenses",
    summary:
      "Cover already on home, motor, travel, or similar policies — or through a union / membership — that may pay legal costs for some problems.",
    whenItFits: "Check policies and memberships before paying privately.",
    likelihood: "sometimes",
    sourceUrl: GOV_PI_INSURANCE,
    sourceLabel: "GOV.UK",
  },
  {
    id: "union_cover",
    title: "Union or employer legal cover",
    summary:
      "Some unions and workplace schemes fund advice or representation for work and related disputes.",
    whenItFits: "Employment and some related civil problems.",
    likelihood: "sometimes",
  },
  {
    id: "cfa_dba",
    title: "No win, no fee (CFA / DBA)",
    summary:
      "Conditional or damages-based agreements mean solicitor fees often depend on winning — other costs (experts, court, opponent’s costs) can still arise.",
    whenItFits: "Common in personal injury and some civil claims; always read the agreement.",
    likelihood: "sometimes",
    sourceUrl: GOV_PI_SOLICITOR,
    sourceLabel: "GOV.UK",
  },
  {
    id: "ate_insurance",
    title: "After-the-event (ATE) insurance",
    summary:
      "Insurance taken out after the dispute starts to protect against large adverse costs. A solicitor often helps arrange it; not every case is insurable.",
    whenItFits: "Higher-risk or higher-value civil claims where adverse costs matter.",
    likelihood: "rare",
    sourceUrl: GOV_PI_INSURANCE,
    sourceLabel: "GOV.UK",
  },
  {
    id: "fixed_fee_private",
    title: "Fixed-fee or private paying",
    summary:
      "Pay for a defined piece of work (letter, consult, consent order) once papers are ready. Useful when free routes are not enough.",
    whenItFits: "Clear, bounded asks — less so open-ended complex trials without a cost plan.",
    likelihood: "often",
  },
  {
    id: "third_party_funding",
    title: "Third-party litigation funding",
    summary:
      "A funder pays legal costs in return for a share of proceeds. Selective: merits, value, and recoverability matter. Many personal consumer disputes will not qualify.",
    whenItFits: "High-value commercial, group, insolvency, competition, and some specialist claims.",
    likelihood: "rare",
  },
  {
    id: "broker_marketplace",
    title: "Funding broker or marketplace",
    summary:
      "Brokers and panels help place ATE or funding — they are not themselves a promise of money. Useful when the case is complex and you need someone to test the market.",
    whenItFits: "Complex or higher-value claims where direct funder matching is unclear.",
    likelihood: "sometimes",
  },
  {
    id: "crowdfunding",
    title: "Crowdfunding / community support",
    summary:
      "Public fundraising can cover fees in cause-driven or public-interest matters. Not a substitute for merits advice and cost risk.",
    whenItFits: "Selected public-interest or community cases — rare for ordinary private disputes.",
    likelihood: "unlikely",
  },
];

/**
 * Curated contacts from our financing directory notes.
 * Roles are explicit so we never imply every entry funds every claim.
 */
export const FINANCING_CONTACTS: FinancingContact[] = [
  {
    id: "gov-check-insurance",
    name: "GOV.UK — Check legal expenses insurance",
    role: "guidance",
    blurb: "Official reminder to check home, motor, holiday policies and memberships for legal expenses cover; also explains ATE.",
    url: GOV_PI_INSURANCE,
    matterHints: ["insurance", "ate", "bte", "costs"],
  },
  {
    id: "ca-affordable",
    name: "Citizens Advice — Free or affordable legal help",
    role: "guidance",
    blurb: "National overview of legal aid, free/fixed-fee consults, and no win no fee agreements.",
    url: CA_AFFORDABLE,
    matterHints: ["free", "cfa", "legal aid", "costs"],
  },
  {
    id: "factor-risk",
    name: "Factor Risk Management",
    role: "broker",
    blurb: "Broker/adviser on litigation funding and ATE — not a direct funder. Useful to test whether insurance or funding is realistic.",
    url: "https://www.factor-risk.com/",
    matterHints: ["ate", "commercial", "litigation", "insolvency", "clinical", "injury"],
    complexOnly: true,
  },
  {
    id: "qlp",
    name: "QLP",
    role: "broker",
    blurb: "Broker for ATE and litigation funding; pages reference commercial, insolvency court-fee funding, clinical negligence and PI.",
    url: "https://www.qlp.ltd.uk/",
    matterHints: ["ate", "commercial", "insolvency", "clinical", "injury", "negligence"],
    complexOnly: true,
  },
  {
    id: "sentry",
    name: "Sentry Funding",
    role: "marketplace",
    blurb: "Marketplace / panel access — matches claimants to legal finance by case type, value, and jurisdiction. Not a single funder.",
    url: "https://sentryfunding.co.uk/",
    matterHints: ["funding", "commercial", "litigation", "panel"],
    complexOnly: true,
  },
  {
    id: "claimtrading",
    name: "ClaimTrading",
    role: "broker",
    blurb: "Broker/arranger for litigation and arbitration funding, enforcement, and portfolio finance.",
    url: "https://www.claimtrading.com/",
    matterHints: ["commercial", "arbitration", "enforcement", "portfolio"],
    complexOnly: true,
  },
  {
    id: "axiafunder",
    name: "AxiaFunder",
    role: "marketplace",
    blurb: "Platform for claimant-side funded litigation; public materials reference commercial, class actions, and housing disrepair.",
    url: "https://www.axiafunder.com/",
    matterHints: ["housing", "disrepair", "commercial", "class", "group"],
    kinds: ["housing", "general", "neighbour"],
    complexOnly: true,
  },
  {
    id: "burford",
    name: "Burford Capital",
    role: "funder",
    blurb: "Large commercial litigation/arbitration funder. Typically high-value business, fraud, securities, competition, IP — not ordinary consumer rows.",
    url: "https://www.burfordcapital.com/",
    matterHints: ["commercial", "arbitration", "fraud", "securities", "competition", "ip", "insolvency"],
    complexOnly: true,
  },
  {
    id: "harbour",
    name: "Harbour Litigation Funding",
    role: "funder",
    blurb: "High-value commercial disputes, single-claim and portfolio funding.",
    url: "https://www.harbourlitigationfunding.com/",
    matterHints: ["commercial", "litigation", "arbitration", "portfolio"],
    complexOnly: true,
  },
  {
    id: "therium",
    name: "Therium",
    role: "funder",
    blurb: "Commercial litigation/arbitration, portfolio funding, securities group litigation, and large group claimant cases (including some employment-style group claims).",
    url: "https://www.therium.com/",
    matterHints: ["commercial", "group", "securities", "employment", "equal pay", "class"],
    kinds: ["employment", "general"],
    complexOnly: true,
  },
  {
    id: "woodsford",
    name: "Woodsford",
    role: "funder",
    blurb: "Collective redress, shareholder/investor, ESG-related, and claimant-side funded litigation.",
    url: "https://woodsford.com/",
    matterHints: ["collective", "group", "shareholder", "investor", "esg", "class"],
    complexOnly: true,
  },
  {
    id: "asertis",
    name: "Asertis",
    role: "funder",
    blurb: "Insolvency, commercial litigation, arbitration, group actions, securities, asset tracing/enforcement.",
    url: "https://asertis.co.uk/",
    matterHints: ["insolvency", "commercial", "group", "securities", "enforcement"],
    complexOnly: true,
  },
];

const COMPLEX_STORY =
  /\b(complex|high[- ]?value|group claim|class action|collective|commercial|arbitration|insolvency|competition|antitrust|securities|shareholder|portfolio|multi[- ]?party|contested hearing|trial|tribunal claim|large claim|six figure|seven figure|£\s?\d{2,}|fraud|fiduciary|patent|ip dispute)\b/i;

const COMPLEX_KINDS: DisputeKind[] = ["neighbour", "general", "employment", "housing"];

export function assessClaimComplexity(input: {
  kind: DisputeKind | null;
  story: string;
  preference?: FundingPreference | null;
}): { complexity: "standard" | "complex"; reason: string } {
  const story = input.story || "";
  if (COMPLEX_STORY.test(story)) {
    return {
      complexity: "complex",
      reason:
        "Your description suggests a higher-value, contested, or specialist matter — financing options beyond free advice matter more here.",
    };
  }
  if (input.kind && COMPLEX_KINDS.includes(input.kind) && story.split(/\s+/).length > 40) {
    return {
      complexity: "complex",
      reason:
        "This kind of dispute can become costly if it escalates — map financing before solicitor costs rise.",
    };
  }
  if (input.preference === "private" || input.preference === "fixed_fee") {
    return {
      complexity: "standard",
      reason:
        "We’ll still show the full financing menu so you can see free, insurance, and no-win-no-fee doors before you pay.",
    };
  }
  return {
    complexity: "standard",
    reason:
      "Most people start with free advice and legal aid/insurance checks. Specialist funding is only for some claims.",
  };
}

function routeLikelihoodFor(
  route: FinancingRoute,
  kind: DisputeKind | null,
  complexity: "standard" | "complex",
  preference?: FundingPreference | null,
): FinancingLikelihood {
  if (route.id === "legal_aid") {
    if (kind === "housing" || kind === "divorce" || kind === "debt") return "sometimes";
    if (kind === "employment" || kind === "consumer" || kind === "benefits") return "unlikely";
    return route.likelihood;
  }
  if (route.id === "union_cover") {
    return kind === "employment" ? "sometimes" : "unlikely";
  }
  if (route.id === "cfa_dba") {
    if (kind === "consumer" || /\binjur|accident|negligence/i.test(kind || "")) return "sometimes";
    return complexity === "complex" ? "sometimes" : "rare";
  }
  if (route.id === "ate_insurance" || route.id === "third_party_funding" || route.id === "broker_marketplace") {
    return complexity === "complex" ? "sometimes" : "unlikely";
  }
  if (route.id === "crowdfunding") return "unlikely";
  if (route.id === "fixed_fee_private") {
    if (preference === "private" || preference === "fixed_fee") return "often";
    return "sometimes";
  }
  if (route.id === "bte_insurance") {
    if (preference === "insurance") return "often";
    return "sometimes";
  }
  return route.likelihood;
}

function contactRelevant(
  contact: FinancingContact,
  kind: DisputeKind | null,
  story: string,
  complexity: "standard" | "complex",
): boolean {
  if (contact.role === "guidance") return true;
  if (contact.complexOnly && complexity !== "complex") return false;
  if (contact.kinds?.length && kind && !contact.kinds.includes(kind)) {
    // Still allow if story hints match strongly
    const hit = contact.matterHints.some((h) => new RegExp(`\\b${h}\\b`, "i").test(story));
    if (!hit) return false;
  }
  if (contact.role === "funder" || contact.role === "broker" || contact.role === "marketplace") {
    const hintHit = contact.matterHints.some((h) =>
      new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(story),
    );
    // For complex cases, show a short curated panel even without keyword hit
    if (complexity === "complex") return true;
    return hintHit;
  }
  return true;
}

/**
 * Build a financing map for this claim: menu of routes + selective contacts.
 * Never claims every matter will find a funder.
 */
export function buildFinancingMap(input: {
  kind: DisputeKind | null;
  story: string;
  preference?: FundingPreference | null;
  legalAidLikelihood?: LegalAidLikelihood | null;
}): FinancingMapResult {
  const { complexity, reason } = assessClaimComplexity(input);
  const kind = input.kind;
  const laMap = buildLegalAidMap({
    kind,
    story: input.story,
    screenLikelihood: input.legalAidLikelihood || null,
  });

  const routes = FINANCING_ROUTES.map((route) => {
    let likelihood = routeLikelihoodFor(route, kind, complexity, input.preference);
    if (route.id === "legal_aid") {
      if (input.legalAidLikelihood === "likely") likelihood = "often";
      else if (input.legalAidLikelihood === "possible") likelihood = "sometimes";
      else if (input.legalAidLikelihood === "unlikely") likelihood = "unlikely";
      else if (laMap.scopeBand === "often") likelihood = "sometimes";
      else if (laMap.scopeBand === "rarely_or_never") likelihood = "unlikely";
      else if (laMap.scopeBand === "rare") likelihood = "rare";
    }
    return { ...route, likelihood };
  })
    // Drop clearly irrelevant unlikely routes for standard consumer-like matters to reduce noise
    .filter((route) => {
      if (complexity === "complex") return true;
      if (route.id === "third_party_funding" || route.id === "crowdfunding") return false;
      if (route.id === "broker_marketplace" && route.likelihood === "unlikely") return false;
      return true;
    });

  const contacts = FINANCING_CONTACTS.filter((c) =>
    contactRelevant(c, kind, input.story, complexity),
  )
    // Cap specialist contacts; always keep guidance
    .sort((a, b) => {
      const rank = (r: FinancingContactRole) =>
        r === "guidance" ? 0 : r === "broker" || r === "marketplace" ? 1 : 2;
      return rank(a.role) - rank(b.role) || a.name.localeCompare(b.name);
    })
    .filter((c, _i, arr) => {
      if (c.role === "guidance") return true;
      const specialists = arr.filter((x) => x.role !== "guidance");
      return specialists.indexOf(c) < (complexity === "complex" ? 5 : 2);
    });

  const honestNote =
    complexity === "complex"
      ? "Complex claims need a clear financing map — but third-party funding and ATE are selective. Brokers can test the market; many cases still won’t be funded. Free advice, insurance, legal aid (if in scope), CFA, and private/fixed-fee remain the practical doors for most people."
      : "Not every claim needs litigation funding. Start with free advice, check legal aid and existing insurance/union cover, then fixed-fee or private help if needed. Specialist funders usually only take higher-value or commercial matters.";

  return {
    complexity,
    complexityReason: reason,
    routes,
    contacts,
    honestNote,
    preferenceHint: input.preference || null,
  };
}

export function financingMapToPlanDetail(map: FinancingMapResult): string {
  const lines: string[] = [
    map.complexityReason,
    "",
    ...map.routes.map(
      (r) =>
        `• ${r.title} (${r.likelihood}): ${r.summary} — ${r.whenItFits}`,
    ),
    "",
    map.honestNote,
  ];
  return lines.join("\n");
}
