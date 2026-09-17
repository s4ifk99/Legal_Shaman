import signpostingResources from "@/data/signposting-resources.json";

export type SignpostLink = {
  label: string;
  url: string;
  note?: string;
};

export type SignpostCategory = {
  slug: string;
  title: string;
  description: string;
  links: SignpostLink[];
};

type RawResource = {
  name: string;
  phone?: string;
  description?: string;
  url?: string;
  links?: Array<{ text: string; url: string }>;
};

type RawSection = {
  title: string;
  resources: RawResource[];
};

/** Consumer-facing signpost sections (aligned with wiki Areas). */
export const SIGNPOST_CATEGORY_TITLES = [
  "Getting Help",
  "Courts and Disputes",
  "Home and Housing",
  "Family and Relationships",
  "Wills and Planning Ahead",
  "Work and Employment",
  "Your Business",
  "Money, Benefits and Debt",
  "Consumer Rights",
  "Neighbours and Property",
  "Immigration and Citizenship",
  "Health and Injury",
  "Driving and Parking",
  "Rights and Discrimination",
  "Human Rights and Protest",
  "Palestine Activist Resources",
  "Crime and Police",
  "Education",
] as const;

const SECTION_DESCRIPTIONS: Record<string, string> = {
  "Getting Help": "Legal aid, pro bono, and national advice organisations.",
  "Courts and Disputes": "Starting a claim, court documents, hearings, and enforcement.",
  "Home and Housing": "Renting, buying, eviction, council housing, and repairs.",
  "Family and Relationships": "Divorce, children, domestic abuse, and separation.",
  "Wills and Planning Ahead": "Wills, probate, inheritance, and powers of attorney.",
  "Work and Employment": "Rights at work, redundancy, tribunals, and small employers.",
  "Your Business": "Contracts, company structure, and insolvency for small businesses.",
  "Money, Benefits and Debt": "Universal Credit, debt solutions, tax, and bills.",
  "Consumer Rights": "Faulty goods, refunds, and trader disputes.",
  "Neighbours and Property": "Boundaries, noise, and neighbour disputes.",
  "Immigration and Citizenship": "Visas, settled status, asylum, and citizenship.",
  "Health and Injury": "Personal injury and clinical negligence.",
  "Driving and Parking": "Motoring offences, PCNs, and the Highway Code.",
  "Rights and Discrimination": "Equality Act, human rights, and disability rights.",
  "Human Rights and Protest":
    "Human Rights Act, freedom of expression, assembly, protest restrictions, and police powers.",
  "Palestine Activist Resources":
    "Lawful Palestine solidarity protest guidance, arrest rights, legal support, and activist resources.",
  "Crime and Police": "If you are accused, victim support, and complaints about police.",
  Education: "School exclusions, SEND, and education rights.",
};

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildLinks(resources: RawResource[]): SignpostLink[] {
  const links: SignpostLink[] = [];

  for (const resource of resources) {
    const noteParts = [resource.description?.trim(), resource.phone ? `Tel: ${resource.phone}` : ""].filter(
      Boolean,
    );

    if (resource.url) {
      links.push({
        label: resource.name,
        url: resource.url,
        note: noteParts.length ? noteParts.join(" · ") : undefined,
      });
    }

    for (const sub of resource.links ?? []) {
      links.push({
        label: sub.text,
        url: sub.url,
      });
    }
  }

  return links;
}

function buildCategories(): SignpostCategory[] {
  const sections = signpostingResources.sections as RawSection[];
  const byTitle = new Map(sections.map((section) => [section.title, section]));

  return SIGNPOST_CATEGORY_TITLES.map((title) => {
    const section = byTitle.get(title);
    const links = section ? buildLinks(section.resources) : [];

    return {
      slug: slugify(title),
      title,
      description: SECTION_DESCRIPTIONS[title] ?? `Useful contacts and resources for ${title.toLowerCase()}.`,
      links,
    };
  });
}

export const signpostCategories: SignpostCategory[] = buildCategories();
