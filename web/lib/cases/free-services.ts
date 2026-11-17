import type { DisputeKind } from "@/lib/cases/dispute-context";
import { isSolicitorComplaintStory } from "@/lib/cases/solicitor-complaint";
import {
  detectGuideNation,
  guideServicesFor,
  type UkGuideNation,
} from "@/lib/cases/pro-bono-guide-knowledge";

export type FreeServiceLead = {
  id: string;
  name: string;
  blurb: string;
  /** Optional public site — shown as named door, not a bare dump of links. */
  url?: string;
  phone?: string;
};

/** Baseline doors when the matter is a problem with a solicitor (Exa-confirmed routes). */
export const SOLICITOR_COMPLAINT_SERVICES: FreeServiceLead[] = [
  {
    id: "legal-ombudsman",
    name: "Legal Ombudsman",
    blurb:
      "For poor service, delays, communication failures, lost papers, or bill disputes after you’ve complained to the firm (or waited 8 weeks). Can recommend apology, fee reduction, or compensation.",
    url: "https://www.legalombudsman.org.uk/how-to-complain/",
    phone: "0300 555 0333",
  },
  {
    id: "sra-report",
    name: "Solicitors Regulation Authority (SRA)",
    blurb:
      "Report serious conduct concerns — dishonesty, misuse of money, discrimination, or rule breaches. Not for ordinary delays or fee arguments (use the Legal Ombudsman for those).",
    url: "https://www.sra.org.uk/consumers/problems/report-solicitor/",
  },
  {
    id: "govuk-complain-legal-adviser",
    name: "GOV.UK — Complain about a legal adviser",
    blurb:
      "Official overview of the firm’s complaints process first, then Legal Ombudsman if unresolved.",
    url: "https://www.gov.uk/complain-about-legal-adviser",
  },
  {
    id: "law-society-complain",
    name: "The Law Society — Complain about a solicitor",
    blurb:
      "Plain steps: complain to the firm, escalate service issues to the Legal Ombudsman, report conduct to the SRA.",
    url: "https://www.lawsociety.org.uk/public/for-public-visitors/using-a-solicitor/complain-about-a-solicitor",
  },
  {
    id: "sra-right-to-complain",
    name: "SRA — Your right to complain",
    blurb:
      "Firms must publish a complaints procedure and tell you about the SRA and Legal Ombudsman.",
    url: "https://www.sra.org.uk/consumers/instructing/your-right-to-complain/",
  },
];

const DIVORCE: FreeServiceLead[] = [
  {
    id: "advicenow-divorce",
    name: "Advicenow — divorce & separation guides",
    blurb: "Plain-English guides on divorce, children, and money arrangements.",
    url: "https://www.advicenow.org.uk/",
  },
  {
    id: "fmc-mediation",
    name: "Family Mediation Council — find a mediator",
    blurb: "Search for family mediators if you want to agree children or money without a contested hearing.",
    url: "https://www.familymediationcouncil.org.uk/find-a-mediator/",
  },
  {
    id: "sorting-out-separation",
    name: "Sorting Out Separation",
    blurb: "National online support and signposting for parents going through separation.",
    url: "https://www.sortingoutseparation.org.uk/",
  },
  {
    id: "law-centres-family",
    name: "Law Centres Network",
    blurb: "Find a local law centre that may help with family and related problems.",
    url: "https://www.lawcentres.org.uk/",
  },
];

const HOUSING: FreeServiceLead[] = [
  {
    id: "shelter",
    name: "Shelter",
    blurb: "Free housing advice — especially useful for eviction risk, homelessness, and serious disrepair.",
    url: "https://england.shelter.org.uk/get_help",
    phone: "0808 800 4444",
  },
  {
    id: "housing-ombudsman",
    name: "Housing Ombudsman",
    blurb: "For many social landlords after you’ve completed their complaints process.",
    url: "https://www.housing-ombudsman.org.uk/",
  },
  {
    id: "law-centres-housing",
    name: "Law Centres Network",
    blurb: "Local law centres often help with housing rights and notices.",
    url: "https://www.lawcentres.org.uk/",
  },
];

const EMPLOYMENT: FreeServiceLead[] = [
  {
    id: "acas",
    name: "ACAS",
    blurb: "Free guidance on workplace rights and Early Conciliation before most tribunal claims.",
    url: "https://www.acas.org.uk/",
    phone: "0300 123 1100",
  },
  {
    id: "law-centres-work",
    name: "Law Centres Network",
    blurb: "Some law centres and clinics help with employment problems.",
    url: "https://www.lawcentres.org.uk/",
  },
];

const DEBT: FreeServiceLead[] = [
  {
    id: "national-debtline",
    name: "National Debtline",
    blurb: "Free debt advice for England — budgets, creditors, and formal options explained.",
    url: "https://www.nationaldebtline.org/",
    phone: "0808 808 4000",
  },
  {
    id: "stepchange",
    name: "StepChange",
    blurb: "Free debt charity — repayment plans and breathing space guidance.",
    url: "https://www.stepchange.org/",
  },
];

const CONSUMER: FreeServiceLead[] = [
  {
    id: "resolver",
    name: "Resolver",
    blurb: "Free tool to complain to traders and keep a clear timeline.",
    url: "https://www.resolver.co.uk/",
  },
  {
    id: "fos",
    name: "Financial Ombudsman Service",
    blurb: "For many bank, insurance, and finance complaints after the firm’s final response.",
    url: "https://www.financial-ombudsman.org.uk/",
  },
];

const BENEFITS: FreeServiceLead[] = [
  {
    id: "citizens-advice-benefits",
    name: "Citizens Advice — benefits",
    blurb: "Free help with Universal Credit decisions, sanctions, and appeals.",
    url: "https://www.citizensadvice.org.uk/benefits/",
  },
  {
    id: "gov-mr",
    name: "GOV.UK — Mandatory reconsideration",
    blurb: "Official steps to ask DWP to look at a benefit decision again.",
    url: "https://www.gov.uk/mandatory-reconsideration",
  },
  {
    id: "gov-appeal-benefit",
    name: "GOV.UK — Appeal a benefit decision",
    blurb: "How to appeal to the tribunal after mandatory reconsideration.",
    url: "https://www.gov.uk/appeal-benefit-decision",
  },
  {
    id: "advicenow-benefits",
    name: "Advicenow",
    blurb: "Plain-English guides on benefits challenges and tribunals.",
    url: "https://www.advicenow.org.uk/",
  },
  {
    id: "law-centres-benefits",
    name: "Law Centres Network",
    blurb: "Some local law centres help with benefits appeals — check what your area covers.",
    url: "https://www.lawcentres.org.uk/",
  },
];

const NEIGHBOUR: FreeServiceLead[] = [
  {
    id: "council-asb",
    name: "Your local council",
    blurb: "Noise and antisocial behaviour teams can investigate before you pay for private letters.",
  },
  {
    id: "law-centres-neighbour",
    name: "Law Centres Network",
    blurb: "Useful if the dispute overlaps with housing, harassment, or protection issues.",
    url: "https://www.lawcentres.org.uk/",
  },
];

const GENERAL: FreeServiceLead[] = [
  {
    id: "advicenow-general",
    name: "Advicenow",
    blurb: "Guides that explain common legal processes in plain English.",
    url: "https://www.advicenow.org.uk/",
  },
  {
    id: "law-centres-general",
    name: "Law Centres Network",
    blurb: "Find free or low-cost local legal help by area.",
    url: "https://www.lawcentres.org.uk/",
  },
];

function curatedForKind(kind: DisputeKind | null | undefined): FreeServiceLead[] {
  switch (kind) {
    case "divorce":
      return DIVORCE;
    case "housing":
      return HOUSING;
    case "employment":
      return EMPLOYMENT;
    case "debt":
      return DEBT;
    case "consumer":
      return CONSUMER;
    case "neighbour":
      return NEIGHBOUR;
    case "benefits":
      return BENEFITS;
    default:
      return GENERAL;
  }
}

/**
 * Free-advice doors for this matter — merges claim-type curated leads with
 * Pro Bono Week guide doors for the detected UK nation (England / Wales / Scotland).
 */
export function freeServicesForKind(
  kind: DisputeKind | null | undefined,
  story?: string | null,
  nationHint?: UkGuideNation | null,
): FreeServiceLead[] {
  if (story && isSolicitorComplaintStory(story)) {
    return SOLICITOR_COMPLAINT_SERVICES;
  }
  const nation = nationHint || detectGuideNation(story || "");
  const curated = curatedForKind(kind);
  // Nation overlays from the three official guides take priority for local accuracy.
  const fromGuides = guideServicesFor(kind, nation, 6);
  if (nation === "scotland" || nation === "wales") {
    return mergeFreeServiceLeads(fromGuides, curated, 8);
  }
  return mergeFreeServiceLeads(curated, fromGuides, 8);
}

export function mergeFreeServiceLeads(
  primary: FreeServiceLead[],
  extra: FreeServiceLead[],
  limit = 8,
): FreeServiceLead[] {
  const out: FreeServiceLead[] = [];
  const seen = new Set<string>();
  for (const s of [...primary, ...extra]) {
    const key = (s.url || s.id || s.name).toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
