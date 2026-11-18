/**
 * Signposting knowledge curated from the Pro Bono Week / Attorney General’s
 * Pro Bono Committee guides (England & Wales Nov 2025, Scotland Nov 2024,
 * Wales Nov 2024). Used to guide clients to free advice doors — not legal advice.
 *
 * Source PDFs: /public/guides/pro-bono-*.pdf
 * Official download hub: https://probonocommittee.uk/guide
 */
import type { DisputeKind } from "@/lib/cases/dispute-context";
import type { FreeServiceLead } from "@/lib/cases/free-services";

export type UkGuideNation = "england" | "wales" | "scotland" | "unknown";

export type GuideTopic =
  | "general"
  | "benefits"
  | "housing"
  | "employment"
  | "debt"
  | "consumer"
  | "family"
  | "neighbour"
  | "pro_bono";

export type GuideService = FreeServiceLead & {
  nations: Array<"england" | "wales" | "scotland" | "uk">;
  topics: GuideTopic[];
  guideSource: "england_wales_2025" | "scotland_2024" | "wales_2024";
};

export const GUIDE_ATTRIBUTION = {
  title: "Guide to Pro Bono and Other Free Advice",
  hubUrl: "https://probonocommittee.uk/guide",
  englandWalesPdf: "/guides/pro-bono-england-wales-2025.pdf",
  scotlandPdf: "/guides/pro-bono-scotland-2024.pdf",
  walesPdf: "/guides/pro-bono-wales-2024.pdf",
  honestNote:
    "Free and pro bono help is limited — providers may have no capacity. Check the organisation’s website before you call. This map is guided by the Pro Bono Week directories; it is not legal advice and does not guarantee help.",
};

/** Detect UK nation for guide selection from the client’s story / answers. */
export function detectGuideNation(text: string): UkGuideNation {
  const t = (text || "").toLowerCase();
  if (
    /\b(northern ireland|belfast|ni\b|ulster)\b/.test(t) &&
    !/\b(scotland|wales|england)\b/.test(t)
  ) {
    // Guides cover E&W + Scotland; NI falls back to UK-wide doors with a note.
    return "unknown";
  }
  if (
    /\b(scotland|scottish|glasgow|edinburgh|aberdeen|dundee|inverness|msp\b|mygov\.scot|citizens advice scotland)\b/.test(
      t,
    )
  ) {
    return "scotland";
  }
  if (
    /\b(wales|welsh|cymru|cardiff|swansea|wrexham|newport|senedd|shelter cymru|advicelink)\b/.test(
      t,
    )
  ) {
    return "wales";
  }
  if (
    /\b(england|english|london|manchester|birmingham|leeds|liverpool|bristol|newcastle|sra\b)\b/.test(
      t,
    )
  ) {
    return "england";
  }
  return "unknown";
}

export function nationLabel(nation: UkGuideNation): string {
  switch (nation) {
    case "scotland":
      return "Scotland";
    case "wales":
      return "Wales";
    case "england":
      return "England";
    default:
      return "England & Wales (default) — tell us if you’re in Scotland or Wales";
  }
}

function topicForKind(kind: DisputeKind | null | undefined): GuideTopic {
  switch (kind) {
    case "benefits":
      return "benefits";
    case "housing":
      return "housing";
    case "employment":
      return "employment";
    case "debt":
      return "debt";
    case "consumer":
      return "consumer";
    case "divorce":
      return "family";
    case "neighbour":
      return "neighbour";
    default:
      return "general";
  }
}

function nationMatches(
  entry: GuideService,
  nation: UkGuideNation,
): boolean {
  if (entry.nations.includes("uk")) return true;
  if (nation === "scotland") return entry.nations.includes("scotland");
  if (nation === "wales") return entry.nations.includes("wales");
  // england or unknown → England & Wales guide doors
  return entry.nations.includes("england") || entry.nations.includes("wales");
}

/** Core national doors from the three guides. */
export const GUIDE_SERVICES: GuideService[] = [
  // —— General / find local ——
  {
    id: "guide-advicelocal",
    name: "Advicelocal",
    blurb:
      "Enter your postcode and topic to find free local advice organisations and online guidance (benefits, debt, housing, employment, and more).",
    url: "https://advicelocal.uk/",
    nations: ["uk"],
    topics: ["general", "benefits", "housing", "employment", "debt", "family", "neighbour"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-advicenow",
    name: "Advicenow",
    blurb:
      "Plain-English guides on common legal processes — useful before or alongside speaking to an adviser.",
    url: "https://www.advicenow.org.uk/",
    nations: ["uk"],
    topics: ["general", "benefits", "family", "debt", "consumer"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-adviceuk",
    name: "AdviceUK — find a member",
    blurb:
      "Largest network of advice organisations across England, Scotland and Wales — many help with benefits, debt, housing and employment.",
    url: "https://www.adviceuk.org.uk/about/contact",
    nations: ["uk"],
    topics: ["general", "benefits", "debt", "housing", "employment"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-turn2us-finder",
    name: "Turn2us Advice Finder",
    blurb: "Search for local advice agencies and support near you.",
    url: "https://advicefinder.turn2us.org.uk/",
    nations: ["uk"],
    topics: ["general", "benefits", "debt"],
    guideSource: "england_wales_2025",
  },

  // —— Citizens Advice ——
  {
    id: "guide-citizens-advice",
    name: "Citizens Advice",
    blurb:
      "Free confidential advice on benefits, work, debt, housing, consumer and family. Start online, then use the national helpline or your local bureau.",
    url: "https://www.citizensadvice.org.uk/",
    phone: "0800 144 8844",
    nations: ["england", "wales"],
    topics: ["general", "benefits", "debt", "housing", "employment", "consumer", "family"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-cas",
    name: "Citizens Advice Scotland",
    blurb:
      "Free advice for people in Scotland — benefits, work, debt, consumer, housing, family, immigration and more. Helpline and local bureaux.",
    url: "https://www.citizensadvice.org.uk/scotland/",
    phone: "0800 028 1456",
    nations: ["scotland"],
    topics: ["general", "benefits", "debt", "housing", "employment", "consumer", "family"],
    guideSource: "scotland_2024",
  },
  {
    id: "guide-advicelink-cymru",
    name: "AdviceLink Cymru (Citizens Advice)",
    blurb:
      "Welsh Government-funded advice on housing, welfare benefits, debt, employment, education, immigration and discrimination. Prefer Welsh organisations for devolved law.",
    url: "https://www.citizensadvice.org.uk/about-us/our-work/advice-partnerships/advicelink-cymru/",
    phone: "0800 702 2020",
    nations: ["wales"],
    topics: ["general", "housing", "benefits", "debt", "employment"],
    guideSource: "wales_2024",
  },

  // —— Law centres / clinics / pro bono ——
  {
    id: "guide-law-centres",
    name: "Law Centres Network",
    blurb:
      "Find a local law centre for free specialist advice and representation in social welfare law (housing, benefits, employment, discrimination, and more).",
    url: "https://www.lawcentres.org.uk/",
    nations: ["england", "wales"],
    topics: ["general", "housing", "benefits", "employment", "debt", "family"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-lawworks-clinics",
    name: "LawWorks Clinics Network",
    blurb:
      "Directory of free legal advice clinics staffed by volunteer solicitors — check what topics your local clinic covers.",
    url: "https://www.lawworks.org.uk/legal-advice-individuals/find-legal-advice-clinic-near-you",
    nations: ["england", "wales", "scotland"],
    topics: ["general", "pro_bono", "debt", "employment", "family", "consumer"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-advocate",
    name: "Advocate (Bar pro bono)",
    blurb:
      "The Bar’s pro bono charity — can find a volunteer barrister for suitable cases when legal aid is not available. Usually needs a referral after initial advice.",
    url: "https://weareadvocate.org.uk/",
    nations: ["england", "wales"],
    topics: ["general", "pro_bono", "benefits", "housing", "employment", "family"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-support-through-court",
    name: "Support Through Court",
    blurb:
      "Free practical and emotional support for people facing court without a lawyer (not legal advice).",
    url: "https://www.supportthroughcourt.org/",
    nations: ["england", "wales"],
    topics: ["general", "family", "neighbour", "debt", "consumer"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-flsu",
    name: "Faculty of Advocates — Free Legal Services Unit",
    blurb:
      "Scotland’s advocate pro bono unit — free help from advocates in suitable cases where other funding is not available.",
    url: "https://www.advocates.org.uk/",
    nations: ["scotland"],
    topics: ["general", "pro_bono", "family", "housing", "benefits"],
    guideSource: "scotland_2024",
  },
  {
    id: "guide-shelter-scotland",
    name: "Shelter Scotland — Housing Law Service",
    blurb:
      "Housing and homelessness advice for Scotland, including specialist legal help where available.",
    url: "https://scotland.shelter.org.uk/",
    nations: ["scotland"],
    topics: ["housing"],
    guideSource: "scotland_2024",
  },
  {
    id: "guide-justright-scotland",
    name: "JustRight Scotland",
    blurb:
      "National law centre in Scotland — human rights, immigration, women’s rights and related social welfare work.",
    url: "https://www.justrightscotland.org.uk/",
    nations: ["scotland"],
    topics: ["general", "housing", "benefits", "family"],
    guideSource: "scotland_2024",
  },

  // —— Wales housing / devolved ——
  {
    id: "guide-shelter-cymru",
    name: "Shelter Cymru",
    blurb:
      "Housing advice for Wales — eviction, homelessness, disrepair and finding a place to live. Welsh rental law differs from England (Renting Homes Wales Act).",
    url: "https://sheltercymru.org.uk/",
    phone: "08000 495 495",
    nations: ["wales"],
    topics: ["housing"],
    guideSource: "wales_2024",
  },
  {
    id: "guide-law-gov-wales",
    name: "law.gov.wales",
    blurb:
      "Official plain-language overview of Welsh law — useful when housing, education or health & social care rules differ from England.",
    url: "https://law.gov.wales/",
    nations: ["wales"],
    topics: ["general", "housing"],
    guideSource: "wales_2024",
  },
  {
    id: "guide-wales-rent-arrears",
    name: "AdviceLink — private rent arrears (Wales)",
    blurb:
      "Dedicated line for private rent arrears advice in Wales via Citizens Advice / AdviceLink Cymru.",
    url: "https://www.citizensadvice.org.uk/about-us/our-work/advice-partnerships/advicelink-cymru/",
    phone: "0808 278 7920",
    nations: ["wales"],
    topics: ["housing", "debt"],
    guideSource: "wales_2024",
  },

  // —— Benefits (E&W guide § Benefits) ——
  {
    id: "guide-help-to-claim-england",
    name: "Citizens Advice — Help to Claim (England)",
    blurb: "Free help applying for Universal Credit in England.",
    url: "https://www.citizensadvice.org.uk/benefits/universal-credit/",
    phone: "0800 144 8444",
    nations: ["england"],
    topics: ["benefits"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-help-to-claim-wales",
    name: "Citizens Advice — Help to Claim (Wales)",
    blurb: "Free help applying for Universal Credit in Wales.",
    url: "https://www.citizensadvice.org.uk/wales/benefits/",
    phone: "0800 0241 220",
    nations: ["wales"],
    topics: ["benefits"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-help-to-claim-scotland",
    name: "Citizens Advice — Help to Claim (Scotland)",
    blurb: "Free help applying for Universal Credit in Scotland.",
    url: "https://www.citizensadvice.org.uk/scotland/benefits/",
    phone: "0800 023 2581",
    nations: ["scotland"],
    topics: ["benefits"],
    guideSource: "scotland_2024",
  },
  {
    id: "guide-turn2us",
    name: "Turn2us",
    blurb:
      "Benefits entitlement calculator, grants search, and guidance for people in financial need.",
    url: "https://www.turn2us.org.uk/",
    phone: "0808 802 2000",
    nations: ["uk"],
    topics: ["benefits", "debt"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-fru",
    name: "Free Representation Unit (FRU)",
    blurb:
      "Free representation for some benefit appeals in the First-tier and Upper Tribunal (capacity limited; usually via referral).",
    url: "https://www.thefru.org.uk/",
    nations: ["england", "wales"],
    topics: ["benefits", "employment", "pro_bono"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-scope-benefits",
    name: "Scope helpline",
    blurb: "Advice and support for disabled people and families, including benefits.",
    url: "https://www.scope.org.uk/helpline",
    phone: "0808 800 3333",
    nations: ["uk"],
    topics: ["benefits"],
    guideSource: "england_wales_2025",
  },

  // —— Housing England ——
  {
    id: "guide-shelter-england",
    name: "Shelter",
    blurb:
      "Free housing advice for England — eviction risk, homelessness and serious disrepair. Also see Housing Loss Prevention Advice Service via legal aid for possession hearings.",
    url: "https://england.shelter.org.uk/get_help",
    phone: "0808 800 4444",
    nations: ["england"],
    topics: ["housing"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-hlpas",
    name: "Housing Loss Prevention Advice Service",
    blurb:
      "Legal aid duty advice for people at risk of losing their home — see GOV.UK legal aid / possession hearing guidance.",
    url: "https://www.gov.uk/legal-aid/homelessness",
    nations: ["england", "wales"],
    topics: ["housing"],
    guideSource: "england_wales_2025",
  },

  // —— Employment ——
  {
    id: "guide-acas",
    name: "ACAS",
    blurb:
      "Free workplace rights guidance and Early Conciliation before most employment tribunal claims.",
    url: "https://www.acas.org.uk/",
    phone: "0300 123 1100",
    nations: ["england", "wales", "scotland"],
    topics: ["employment"],
    guideSource: "england_wales_2025",
  },

  // —— Debt ——
  {
    id: "guide-national-debtline",
    name: "National Debtline",
    blurb: "Free debt advice — budgets, creditors and formal options explained.",
    url: "https://www.nationaldebtline.org/",
    phone: "0808 808 4000",
    nations: ["england", "wales", "scotland"],
    topics: ["debt"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-stepchange",
    name: "StepChange",
    blurb: "Free debt charity — repayment plans and breathing-space style support.",
    url: "https://www.stepchange.org/",
    nations: ["uk"],
    topics: ["debt"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-money-advice-scotland",
    name: "Money Advice Scotland",
    blurb: "Scotland-focused money and debt guidance and signposting.",
    url: "https://www.moneyadvicescotland.org.uk/",
    nations: ["scotland"],
    topics: ["debt"],
    guideSource: "scotland_2024",
  },
  {
    id: "guide-ca-debt-helpline",
    name: "Citizens Advice debt helpline",
    blurb: "Debt advice via Citizens Advice (England & Wales) — also webchat on their site.",
    url: "https://www.citizensadvice.org.uk/debt-and-money/",
    phone: "0800 240 4420",
    nations: ["england", "wales"],
    topics: ["debt"],
    guideSource: "england_wales_2025",
  },

  // —— Consumer ——
  {
    id: "guide-ca-consumer",
    name: "Citizens Advice consumer helpline",
    blurb: "Consumer rights help for goods and services problems.",
    url: "https://www.citizensadvice.org.uk/consumer/",
    phone: "0808 223 1133",
    nations: ["england", "wales"],
    topics: ["consumer"],
    guideSource: "england_wales_2025",
  },

  // —— Family ——
  {
    id: "guide-family-mediation",
    name: "Family Mediation Council — find a mediator",
    blurb:
      "Search for family mediators if you want to agree children or money arrangements without a contested hearing.",
    url: "https://www.familymediationcouncil.org.uk/find-a-mediator/",
    nations: ["england", "wales"],
    topics: ["family"],
    guideSource: "england_wales_2025",
  },
  {
    id: "guide-gingerbread",
    name: "Gingerbread",
    blurb: "Support and advice for single parents, including benefits and tax credits.",
    url: "https://www.gingerbread.org.uk/",
    nations: ["uk"],
    topics: ["family", "benefits"],
    guideSource: "england_wales_2025",
  },
];

export function guideServicesFor(
  kind: DisputeKind | null | undefined,
  nation: UkGuideNation,
  limit = 6,
): FreeServiceLead[] {
  const topic = topicForKind(kind);
  const scored = GUIDE_SERVICES.filter((s) => nationMatches(s, nation))
    .map((s) => {
      let score = 0;
      if (s.topics.includes(topic)) score += 5;
      if (s.topics.includes("general")) score += 1;
      if (s.topics.includes("pro_bono") && topic === "general") score += 2;
      // Prefer nation-specific over uk-wide when nation known
      if (nation !== "unknown" && !s.nations.includes("uk") && nationMatches(s, nation)) {
        score += 2;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const out: FreeServiceLead[] = [];
  const seen = new Set<string>();
  for (const { s } of scored) {
    const key = (s.url || s.id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: s.id,
      name: s.name,
      blurb: s.blurb,
      url: s.url,
      phone: s.phone,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function guideSignpostNotes(nation: UkGuideNation): string[] {
  const notes = [
    GUIDE_ATTRIBUTION.honestNote,
    "Start with free front-line advice (Citizens Advice, law centres, specialist charities) before paying privately.",
  ];
  if (nation === "wales") {
    notes.push(
      "In Wales, housing, education and health & social care law can differ from England — prefer Welsh organisations where possible (and say you are in Wales on any referral).",
    );
  }
  if (nation === "scotland") {
    notes.push(
      "Scotland has its own legal system and legal aid rules — use Scottish services (Citizens Advice Scotland, Scottish law centres, mygov.scot) rather than England-only routes.",
    );
  }
  if (nation === "unknown") {
    notes.push(
      "If you live in Scotland or Wales, say so — the free-advice map changes (devolved law and different national networks).",
    );
  }
  return notes;
}

export function pdfForNation(nation: UkGuideNation): { label: string; href: string } {
  if (nation === "scotland") {
    return { label: "Scotland free advice guide (PDF)", href: GUIDE_ATTRIBUTION.scotlandPdf };
  }
  if (nation === "wales") {
    return { label: "Wales free advice guide (PDF)", href: GUIDE_ATTRIBUTION.walesPdf };
  }
  return {
    label: "England & Wales free advice guide (PDF)",
    href: GUIDE_ATTRIBUTION.englandWalesPdf,
  };
}
