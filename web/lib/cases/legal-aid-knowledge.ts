/**
 * Civil legal aid knowledge layer (England & Wales) for Ask the Shaman.
 * Triage / signposting only — not a formal Legal Aid Agency determination.
 * Means figures align with current GOV.UK civil legal aid guidance used in legal-aid-screen.
 */
import type { DisputeKind } from "@/lib/cases/dispute-context";

export type LegalAidLikelihood = "likely" | "possible" | "unlikely" | "unsure";

export type LegalAidScopeBand = "often" | "sometimes" | "rare" | "rarely_or_never";

export type LegalAidScopeDoor = {
  id: string;
  title: string;
  band: LegalAidScopeBand;
  summary: string;
  examples: string[];
  evidenceHelpful?: string[];
  sourceUrl?: string;
};

export type LegalAidMeansRule = {
  id: string;
  title: string;
  summary: string;
  sourceUrl?: string;
};

export type LegalAidMapResult = {
  kind: DisputeKind | null;
  scopeBand: LegalAidScopeBand;
  headline: string;
  scopeDoors: LegalAidScopeDoor[];
  outOfScopeNote: string;
  meansRules: LegalAidMeansRule[];
  meritsNote: string;
  nextSteps: string[];
  screenPriority: "encourage" | "offer" | "educate_then_skip_ok";
  likelihoodFromKindAlone: LegalAidLikelihood;
  sourceUrl: string;
  honestNote: string;
};

const GOV_LEGAL_AID = "https://www.gov.uk/legal-aid";
const GOV_LEGAL_AID_ELIGIBILITY =
  "https://www.gov.uk/check-legal-aid";
const GOV_FIND_PROVIDER =
  "https://find-legal-advice.justice.gov.uk/";
const GOV_FAMILY_ABUSE =
  "https://www.gov.uk/legal-aid/domestic-abuse-or-violence";

/** Shared means rules shown on every legal-aid map. */
export const LEGAL_AID_MEANS_RULES: LegalAidMeansRule[] = [
  {
    id: "passporting",
    title: "Passporting benefits (income)",
    summary:
      "Universal Credit, Income Support, income-based JSA, income-related ESA, or Guarantee Credit of Pension Credit usually pass the income test — capital still matters.",
    sourceUrl: GOV_LEGAL_AID,
  },
  {
    id: "gross_income",
    title: "Gross monthly income",
    summary:
      "If not passporting, household gross monthly income is usually assessed against about £2,657 (with extra for larger families). Partner income often counts unless they are the other side.",
    sourceUrl: GOV_LEGAL_AID,
  },
  {
    id: "disposable_income",
    title: "Disposable income",
    summary:
      "After allowed outgoings, disposable monthly income is usually assessed against about £733 for full civil legal aid.",
    sourceUrl: GOV_LEGAL_AID,
  },
  {
    id: "capital",
    title: "Capital / savings",
    summary:
      "Capital is usually assessed against about £8,000 (main home often treated specially). Some controlled work (e.g. immigration) can use a lower £3,000 cap.",
    sourceUrl: GOV_LEGAL_AID,
  },
];

const KIND_SCOPE: Record<
  DisputeKind,
  {
    band: LegalAidScopeBand;
    headline: string;
    doors: LegalAidScopeDoor[];
    outOfScopeNote: string;
    screenPriority: LegalAidMapResult["screenPriority"];
    likelihoodFromKindAlone: LegalAidLikelihood;
  }
> = {
  housing: {
    band: "often",
    headline: "Housing problems are one of the stronger civil legal aid areas — if the risk is serious enough.",
    doors: [
      {
        id: "homelessness",
        title: "Homelessness / housing duty",
        band: "often",
        summary: "Help when you are homeless or threatened with homelessness and need the council’s housing duties challenged or enforced.",
        examples: ["Homeless application refused", "Interim accommodation refused", "Threatened with street homelessness"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "eviction",
        title: "Eviction / possession",
        band: "often",
        summary: "Defence or urgent help when you risk losing your home through possession proceedings.",
        examples: ["Court possession claim", "Bailiff warrant", "Section 21 / section 8 with hearing risk"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "disrepair",
        title: "Serious disrepair / hazards",
        band: "sometimes",
        summary: "More likely where health/safety is at risk; ordinary repair niggles alone may not qualify.",
        examples: ["Category 1 hazards", "Uninhabitable conditions", "Serious damp/mould with health impact"],
        sourceUrl: GOV_LEGAL_AID,
      },
    ],
    outOfScopeNote:
      "Ordinary rent arguments, deposit-only fights, or mild repair complaints without housing risk are less likely to get civil legal aid.",
    screenPriority: "encourage",
    likelihoodFromKindAlone: "possible",
  },
  divorce: {
    band: "sometimes",
    headline: "Family legal aid is limited for divorce paperwork alone — stronger with domestic abuse, children protection, or care issues.",
    doors: [
      {
        id: "domestic_abuse",
        title: "Domestic abuse / protection",
        band: "often",
        summary: "Evidence of domestic abuse can open family legal aid even when a clean divorce would not.",
        examples: ["Non-molestation / occupation order", "Police / MARAC involvement", "Refuge or support-service evidence"],
        evidenceHelpful: ["Protective order", "Police report", "Letter from support agency", "GP / social services letter"],
        sourceUrl: GOV_FAMILY_ABUSE,
      },
      {
        id: "children",
        title: "Children / care risk",
        band: "sometimes",
        summary: "Child arrangements and especially care/public-law children cases have different legal aid pathways.",
        examples: ["Care proceedings", "Urgent child safety", "Complex child arrangements with risk"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "divorce_only",
        title: "Divorce / financial remedy alone",
        band: "rare",
        summary: "Uncontested divorce and many money/property applications are outside or tightly limited for legal aid.",
        examples: ["Sole/joint divorce form only", "Consent order without abuse evidence"],
        sourceUrl: GOV_LEGAL_AID,
      },
    ],
    outOfScopeNote:
      "A straightforward divorce with no abuse evidence and no care risk often will not get legal aid — mediation info and fixed-fee private help are common alternatives.",
    screenPriority: "encourage",
    likelihoodFromKindAlone: "unsure",
  },
  debt: {
    band: "sometimes",
    headline: "Debt legal aid is narrow — more relevant when housing is at risk or court enforcement needs urgent defence.",
    doors: [
      {
        id: "housing_linked_debt",
        title: "Debt linked to housing risk",
        band: "sometimes",
        summary: "When rent/mortgage arrears threaten your home, housing-linked legal aid routes matter more than general debt advice funding.",
        examples: ["Possession for rent arrears", "Charging order / home at risk"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "enforcement",
        title: "Court enforcement defence",
        band: "rare",
        summary: "Some urgent court enforcement situations can attract help; day-to-day budgeting usually goes to free debt advice instead.",
        examples: ["Bailiffs at the door with a court process", "Urgent set-aside / variation"],
        sourceUrl: GOV_LEGAL_AID,
      },
    ],
    outOfScopeNote:
      "Most credit-card, catalogue, and general over-indebtedness work is free debt advice (StepChange-style), not civil legal aid.",
    screenPriority: "offer",
    likelihoodFromKindAlone: "unlikely",
  },
  employment: {
    band: "rarely_or_never",
    headline: "Most employment disputes are outside civil legal aid.",
    doors: [
      {
        id: "discrimination",
        title: "Discrimination at work",
        band: "rare",
        summary: "Discrimination can be an exception in limited circumstances — still needs a provider merits/means check.",
        examples: ["Protected characteristic discrimination", "Victimisation linked to discrimination"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "trafficking",
        title: "Trafficking / modern slavery angles",
        band: "rare",
        summary: "Specialist public funding routes can exist for trafficking-related work — uncommon for ordinary dismissal/wages claims.",
        examples: ["Modern slavery support", "Labour exploitation with trafficking indicators"],
        sourceUrl: GOV_LEGAL_AID,
      },
    ],
    outOfScopeNote:
      "Unfair dismissal, wages, redundancy, and most tribunal claims are usually ACAS, union, insurance, or private/CFA — not civil legal aid.",
    screenPriority: "educate_then_skip_ok",
    likelihoodFromKindAlone: "unlikely",
  },
  consumer: {
    band: "rarely_or_never",
    headline: "Most consumer disputes are outside civil legal aid.",
    doors: [
      {
        id: "exceptional",
        title: "Exceptional case funding (rare)",
        band: "rarely_or_never",
        summary: "Exceptional Case Funding exists in theory for some out-of-scope matters but is hard to get and not the usual consumer path.",
        examples: ["Human-rights-significant consumer cases (very rare)"],
        sourceUrl: GOV_LEGAL_AID,
      },
    ],
    outOfScopeNote:
      "Faulty goods, refunds, and trader rows usually use free consumer advice, card chargeback/section 75, ADR, or small claims — not legal aid.",
    screenPriority: "educate_then_skip_ok",
    likelihoodFromKindAlone: "unlikely",
  },
  benefits: {
    band: "rarely_or_never",
    headline:
      "Most Universal Credit advice and First-tier Tribunal appeals are outside mainstream civil legal aid — free benefits advice is the usual door.",
    doors: [
      {
        id: "free_benefits_advice",
        title: "Free benefits advice (usual route)",
        band: "rarely_or_never",
        summary:
          "Citizens Advice, welfare rights services, and some law centres help with MR and tribunal appeals without legal aid.",
        examples: ["UC amount wrong", "Sanction challenge", "LCWRA refused", "Overpayment dispute"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "exceptional_ecf",
        title: "Exceptional Case Funding (rare)",
        band: "rarely_or_never",
        summary:
          "ECF can exist for some out-of-scope benefits work but is hard to get — a specialist provider would assess, not this chat.",
        examples: ["Human-rights-significant benefits cases (uncommon)"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "housing_overlap_uc",
        title: "Housing risk overlap",
        band: "sometimes",
        summary:
          "If UC problems tip into homelessness or possession risk, housing legal aid may matter separately from the benefits appeal itself.",
        examples: ["UC housing element failure + eviction risk", "Homeless application linked to UC"],
        sourceUrl: GOV_LEGAL_AID,
      },
    ],
    outOfScopeNote:
      "Do not wait only on legal aid for a UC mandatory reconsideration or First-tier appeal — use free benefits advice and GOV.UK challenge routes.",
    screenPriority: "educate_then_skip_ok",
    likelihoodFromKindAlone: "unlikely",
  },
  neighbour: {
    band: "rare",
    headline: "Neighbour disputes rarely attract civil legal aid unless they overlap with housing, harassment, or abuse.",
    doors: [
      {
        id: "housing_overlap",
        title: "Housing / landlord overlap",
        band: "sometimes",
        summary: "If the neighbour issue is really a landlord/housing-association duty or possession risk, housing legal aid may apply.",
        examples: ["ASB by another tenant of the same landlord", "Possession linked to neighbour conflict"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "harassment_abuse",
        title: "Harassment / domestic abuse overlap",
        band: "sometimes",
        summary: "Protective injunctions or abuse-related family funding can apply when the facts fit — not for ordinary noise rows.",
        examples: ["Harassment injunction", "Abuse by someone in the household / ex-partner neighbour situation"],
        evidenceHelpful: ["Police reports", "Protective order evidence"],
        sourceUrl: GOV_FAMILY_ABUSE,
      },
    ],
    outOfScopeNote:
      "Boundary, parking, and everyday noise disputes usually go to council ASB/noise teams, mediation, or private help — not legal aid.",
    screenPriority: "educate_then_skip_ok",
    likelihoodFromKindAlone: "unlikely",
  },
  general: {
    band: "sometimes",
    headline: "Civil legal aid only covers certain problem types — we map whether yours looks in or out of scope.",
    doors: [
      {
        id: "in_scope_examples",
        title: "Commonly in-scope themes",
        band: "sometimes",
        summary: "Housing risk, some family/abuse, care, mental health, asylum/immigration controlled work, and some discrimination/public-law angles.",
        examples: ["Homelessness", "Domestic abuse protection", "Care proceedings", "Asylum legal aid (separate rules)"],
        sourceUrl: GOV_LEGAL_AID,
      },
      {
        id: "out_scope_examples",
        title: "Commonly out-of-scope themes",
        band: "rarely_or_never",
        summary: "Most consumer, employment, neighbour, and straightforward money claims are outside civil legal aid.",
        examples: ["Refund fights", "Unfair dismissal", "Fence disputes", "Small claims debt"],
        sourceUrl: GOV_LEGAL_AID,
      },
    ],
    outOfScopeNote:
      "If the problem type is out of scope, free advice and other financing doors matter more than a long legal aid chase.",
    screenPriority: "offer",
    likelihoodFromKindAlone: "unsure",
  },
};

export function buildLegalAidMap(input: {
  kind: DisputeKind | null;
  story?: string;
  screenLikelihood?: LegalAidLikelihood | null;
  screenSummary?: string | null;
  screenNotes?: string[];
}): LegalAidMapResult {
  const kind = input.kind || "general";
  const pack = KIND_SCOPE[kind] || KIND_SCOPE.general;
  const story = input.story || "";

  // Story boosts for housing risk / abuse even if kind is general/neighbour
  let doors = [...pack.doors];
  let band = pack.band;
  let headline = pack.headline;
  let screenPriority = pack.screenPriority;
  let likelihoodFromKindAlone = pack.likelihoodFromKindAlone;

  if (/\b(homeless|evict|possession|bailiff).{0,40}\b(home|flat|house|tenanc)/i.test(story) ||
      /\b(threatened with|facing)\s+(eviction|homeless)/i.test(story)) {
    band = "often";
    likelihoodFromKindAlone = "possible";
    screenPriority = "encourage";
    headline =
      "Your story mentions housing risk — civil legal aid is more often relevant for homelessness or eviction.";
  }
  if (/\b(domestic abuse|molestation|occupation order|controlling behaviour|coercive)\b/i.test(story)) {
    band = band === "rarely_or_never" ? "sometimes" : "often";
    likelihoodFromKindAlone = "possible";
    screenPriority = "encourage";
    headline =
      "Your story mentions abuse or protective orders — family legal aid routes can open even when other family work would not.";
  }

  const screened = input.screenLikelihood;
  const nextSteps: string[] = [];
  if (screenPriority === "encourage" || screened === "likely" || screened === "possible") {
    nextSteps.push("Use the GOV.UK check and find a legal-aid provider with your papers.");
    nextSteps.push("Take a short timeline, notices, and any abuse/housing evidence to the first appointment.");
  }
  if (screened === "unlikely" || pack.band === "rarely_or_never") {
    nextSteps.push("Keep free advice and other financing doors open — do not wait only on legal aid.");
  }
  nextSteps.push("A provider’s means and merits decision is the formal answer — this map is triage only.");

  if (screened === "likely") {
    likelihoodFromKindAlone = "likely";
  } else if (screened === "possible" && likelihoodFromKindAlone === "unsure") {
    likelihoodFromKindAlone = "possible";
  } else if (screened === "unlikely") {
    likelihoodFromKindAlone = "unlikely";
  }

  const honestNote =
    screened && input.screenSummary
      ? `${input.screenSummary} ${pack.outOfScopeNote}`
      : `${pack.outOfScopeNote} Means and merits still have to fit — scope alone is not enough.`;

  return {
    kind: input.kind,
    scopeBand: band,
    headline,
    scopeDoors: doors,
    outOfScopeNote: pack.outOfScopeNote,
    meansRules: LEGAL_AID_MEANS_RULES,
    meritsNote:
      "Even in-scope cases need a merits test — a provider assesses whether the case is strong enough and proportionate for public funding.",
    nextSteps,
    screenPriority,
    likelihoodFromKindAlone,
    sourceUrl: GOV_LEGAL_AID,
    honestNote: [
      honestNote,
      ...(input.screenNotes || []),
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function legalAidMapToPlanDetail(map: LegalAidMapResult): string {
  const lines = [
    map.headline,
    "",
    "What can be in scope:",
    ...map.scopeDoors.map(
      (d) => `• ${d.title} (${d.band}): ${d.summary}`,
    ),
    "",
    map.outOfScopeNote,
    "",
    "Means (GOV.UK civil rules — triage):",
    ...map.meansRules.map((r) => `• ${r.title}: ${r.summary}`),
    "",
    map.meritsNote,
    "",
    "Next steps:",
    ...map.nextSteps.map((s) => `• ${s}`),
    "",
    map.honestNote,
    `Check: ${GOV_LEGAL_AID_ELIGIBILITY}`,
    `Find a provider: ${GOV_FIND_PROVIDER}`,
  ];
  return lines.join("\n");
}

export { GOV_LEGAL_AID, GOV_LEGAL_AID_ELIGIBILITY, GOV_FIND_PROVIDER };
