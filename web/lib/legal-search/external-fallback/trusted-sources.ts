import type { ExternalFallbackSourceId } from "@/lib/legal-search/external-fallback/types";
import type { FundingRoute } from "@/lib/legal-search/triage/types";
import type { FallbackSearchContext } from "@/lib/legal-search/external-fallback/types";

export type TrustedSourceDefinition = {
  id: ExternalFallbackSourceId;
  name: string;
  /** Official site — we link out only; no scraping of result listings. */
  officialUrl: string;
  attribution: string;
  fundingType: "legal_aid" | "pro_bono" | "free_advice" | "private" | "unknown";
  regulatedStatus: "sra_regulated" | "unknown" | "not_regulated";
  routes: FundingRoute[];
  priority: number;
  description: string;
  robotsRespected: boolean;
  buildSearchUrl: (ctx: FallbackSearchContext) => string;
};

function encodeQ(s: string): string {
  return encodeURIComponent(s.trim().slice(0, 200));
}

function practiceHint(ctx: FallbackSearchContext): string {
  const slug = ctx.taxonomySlug ?? ctx.parsed.taxonomySlug;
  const map: Record<string, string> = {
    employment: "employment",
    housing: "housing",
    immigration: "immigration",
    family: "family",
    criminal_defence: "crime",
    prison_law: "prison",
    welfare_benefits: "benefits",
    personal_injury: "personal injury",
    clinical_negligence: "clinical negligence",
    wills_probate: "wills probate",
  };
  return slug ? (map[slug] ?? slug.replace(/_/g, " ")) : ctx.mergedQuery.slice(0, 80);
}

function locationHint(ctx: FallbackSearchContext): string {
  return (
    ctx.location ??
    ctx.postcode ??
    ctx.parsed.location ??
    ctx.parsed.postcode ??
    ""
  ).trim();
}

/** Curated trusted UK legal directories — official signpost URLs only. */
export const TRUSTED_SOURCES: TrustedSourceDefinition[] = [
  {
    id: "govuk_legal_aid",
    name: "GOV.UK — Find a legal aid adviser",
    officialUrl: "https://www.gov.uk/legal-aid/search-for-legal-advice",
    attribution: "GOV.UK",
    fundingType: "legal_aid",
    regulatedStatus: "unknown",
    routes: ["legal_aid"],
    priority: 1,
    robotsRespected: true,
    description:
      "Official government tool to find legal aid advisers by legal problem and location. Check eligibility on GOV.UK.",
    buildSearchUrl(ctx) {
      const base = "https://www.gov.uk/legal-aid/search-for-legal-advice";
      const loc = locationHint(ctx);
      if (loc) return `${base}?location=${encodeQ(loc)}`;
      return base;
    },
  },
  {
    id: "lawworks",
    name: "LawWorks — Free legal help",
    officialUrl: "https://www.lawworks.org.uk/our-services/",
    attribution: "LawWorks",
    fundingType: "pro_bono",
    regulatedStatus: "not_regulated",
    routes: ["pro_bono", "legal_aid"],
    priority: 2,
    robotsRespected: true,
    description:
      "Charity connecting people with free legal advice clinics and pro bono support. Availability varies by area.",
    buildSearchUrl() {
      return "https://www.lawworks.org.uk/our-services/";
    },
  },
  {
    id: "advocate",
    name: "Advocate — Pro bono barristers",
    officialUrl: "https://www.weareadvocate.org.uk/",
    attribution: "Advocate",
    fundingType: "pro_bono",
    regulatedStatus: "unknown",
    routes: ["pro_bono"],
    priority: 3,
    robotsRespected: true,
    description:
      "Charity helping to find pro bono representation from barristers. Subject to eligibility and capacity.",
    buildSearchUrl() {
      return "https://www.weareadvocate.org.uk/get-legal-help";
    },
  },
  {
    id: "citizens_advice",
    name: "Citizens Advice",
    officialUrl: "https://www.citizensadvice.org.uk/",
    attribution: "Citizens Advice",
    fundingType: "free_advice",
    regulatedStatus: "not_regulated",
    routes: ["pro_bono", "legal_aid"],
    priority: 4,
    robotsRespected: true,
    description:
      "Free, confidential advice on benefits, housing, employment, debt, and more. Not a substitute for a solicitor.",
    buildSearchUrl(ctx) {
      const topic = practiceHint(ctx).toLowerCase();
      if (topic.includes("benefit")) return "https://www.citizensadvice.org.uk/benefits/";
      if (topic.includes("housing") || topic.includes("evict"))
        return "https://www.citizensadvice.org.uk/housing/";
      if (topic.includes("employ") || topic.includes("work"))
        return "https://www.citizensadvice.org.uk/work/";
      if (topic.includes("immigration") || topic.includes("visa"))
        return "https://www.citizensadvice.org.uk/immigration/";
      if (topic.includes("family") || topic.includes("divorce"))
        return "https://www.citizensadvice.org.uk/family/";
      return "https://www.citizensadvice.org.uk/get-advice/";
    },
  },
  {
    id: "law_society",
    name: "Law Society — Find a Solicitor",
    officialUrl: "https://solicitors.lawsociety.org.uk/",
    attribution: "The Law Society",
    fundingType: "private",
    regulatedStatus: "sra_regulated",
    routes: ["private"],
    priority: 1,
    robotsRespected: true,
    description:
      "Official Law Society directory of solicitors in England and Wales. Verify details with the firm directly.",
    buildSearchUrl(ctx) {
      const q = practiceHint(ctx);
      const loc = locationHint(ctx);
      const params = new URLSearchParams();
      if (q) params.set("LegalIssue", q);
      if (loc) params.set("Location", loc);
      const qs = params.toString();
      return qs
        ? `https://solicitors.lawsociety.org.uk/search/results?${qs}`
        : "https://solicitors.lawsociety.org.uk/";
    },
  },
  {
    id: "sra_register",
    name: "SRA — Solicitors Register",
    officialUrl: "https://www.sra.org.uk/consumers/register/",
    attribution: "Solicitors Regulation Authority",
    fundingType: "private",
    regulatedStatus: "sra_regulated",
    routes: ["private"],
    priority: 2,
    robotsRespected: true,
    description:
      "Official register to check whether a firm or individual is regulated by the SRA. Does not list legal aid providers.",
    buildSearchUrl(ctx) {
      const loc = locationHint(ctx);
      if (loc) {
        return `https://www.sra.org.uk/consumers/register/search/?searchText=${encodeQ(loc)}`;
      }
      return "https://www.sra.org.uk/consumers/register/";
    },
  },
];

export function sourcesForRoutes(
  routes: FundingRoute[],
  opts?: { sraAvailable?: boolean; preferRegulated?: boolean },
): TrustedSourceDefinition[] {
  const routeSet = new Set(routes);
  let list = TRUSTED_SOURCES.filter((s) => s.routes.some((r) => routeSet.has(r)));
  list.sort((a, b) => a.priority - b.priority);

  if (opts?.preferRegulated || !opts?.sraAvailable) {
    const regulated = list.filter((s) => s.regulatedStatus === "sra_regulated");
    const rest = list.filter((s) => s.regulatedStatus !== "sra_regulated");
    list = [...regulated, ...rest];
  }

  return list;
}
