export const NECESSITY_SLUGS = [
  "wills-estates",
  "neighbour-disputes",
  "family-law",
  "property-housing",
  "pcn",
] as const;

export type NecessitySlug = (typeof NECESSITY_SLUGS)[number];

export type NecessityCategory = {
  slug: NecessitySlug;
  title: string;
  need: string;
  query: string;
};

export const NECESSITY_CATEGORIES: NecessityCategory[] = [
  {
    slug: "wills-estates",
    title: "Wills and estates",
    need: "Preparing a will or dealing with an inheritance",
    query: "I need help preparing a will or dealing with an inheritance in England and Wales",
  },
  {
    slug: "neighbour-disputes",
    title: "Neighbour disputes",
    need: "Noise, boundaries, nuisance, or a property disagreement",
    query:
      "I have a neighbour dispute about noise, boundaries, or nuisance and need to know where to get help",
  },
  {
    slug: "family-law",
    title: "Family law",
    need: "Separation, child arrangements, or a financial dispute",
    query:
      "I need help with separation, child arrangements, or a financial dispute after a relationship",
  },
  {
    slug: "property-housing",
    title: "Property and housing",
    need: "Tenancy, deposits, ownership, or a housing dispute",
    query:
      "I have a housing problem about my tenancy, my deposit, or a dispute and I need to know my options",
  },
  {
    slug: "pcn",
    title: "Parking Charge Notices and PCNs",
    need: "Challenging a parking penalty and the deadlines",
    query:
      "I have received a parking penalty charge notice and need to understand the deadlines and how to challenge it",
  },
];

export function parseNecessitySlug(value: string | undefined | null): NecessitySlug | undefined {
  const slug = (value || "").trim();
  return (NECESSITY_SLUGS as readonly string[]).includes(slug) ? (slug as NecessitySlug) : undefined;
}

export type UrgencyNotice = {
  title: string;
  body: string;
  links: { label: string; href: string }[];
};

const HOUSING_URGENCY: UrgencyNotice = {
  title: "Housing deadlines can be short",
  body: "If you have an eviction notice or a court date, act on the dates on the papers. This is signposting, not legal advice. For urgent housing help, contact Shelter or the Housing Loss Prevention Advice Service if you are facing a possession hearing.",
  links: [
    { label: "Shelter", href: "https://www.shelter.org.uk/" },
    {
      label: "Housing Loss Prevention Advice Service",
      href: "https://www.gov.uk/guidance/housing-loss-prevention-advice-service",
    },
  ],
};

const PCN_URGENCY: UrgencyNotice = {
  title: "Parking penalties have short deadlines",
  body: "The date on the notice controls the discount, the time to challenge it, and any appeal. This is signposting, not legal advice. In London, appeals are usually made to London Tribunals.",
  links: [{ label: "London Tribunals", href: "https://www.londontribunals.gov.uk/" }],
};

export function urgencyForNecessity(slug: string | undefined | null): UrgencyNotice | null {
  if (slug === "property-housing") return HOUSING_URGENCY;
  if (slug === "pcn") return PCN_URGENCY;
  return null;
}

const NEIGHBOUR_TEXT = /\b(neighbour|neighbor|boundary|fence|nuisance|driveway)\b/i;
const TENANCY_TEXT = /\b(evict|eviction|section\s*21|possession|landlord|tenan|deposit|rent)\b/i;

/** Housing deadline copy is for tenancy and possession, not a neighbour dispute. */
export function housingDeadlineApplies(input: {
  necessitySlug?: string | null;
  matterType?: string | null;
  taxonomySlug?: string | null;
  text?: string;
}): boolean {
  const text = `${input.taxonomySlug || ""} ${input.text || ""}`;
  const neighbour =
    input.necessitySlug === "neighbour-disputes" ||
    /neighbour/i.test(input.taxonomySlug || "") ||
    NEIGHBOUR_TEXT.test(text);
  const tenancy = TENANCY_TEXT.test(text);
  if (neighbour && !tenancy) return false;
  if (input.necessitySlug === "property-housing") return true;
  return input.matterType === "housing" && tenancy;
}

export function necessitySearchHref(category: NecessityCategory): string {
  const params = new URLSearchParams();
  params.set("q", category.query);
  params.set("necessity", category.slug);
  return `/ask-the-shaman?${params.toString()}`;
}
