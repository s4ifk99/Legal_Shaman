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

/** Homepage Signpost category titles (source of truth for V1 widget). */
export const SIGNPOST_CATEGORY_TITLES = [
  "General advice",
  "Legal aid eligibility & support",
  "Preparing documents and going to court",
  "Remote hearings",
  "National legal advice organisations",
  "Benefits, finance and debt",
  "Financing Options",
  "Crime",
  "Disabilities and mental health",
  "Domestic violence",
  "Education",
  "Employment",
  "Family",
  "Housing",
  "Human rights and public law",
  "Immigration and asylum",
  "Parking PCN",
  "Problem with Police",
] as const;

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
      description: `Useful contacts and resources for ${title.toLowerCase()}.`,
      links,
    };
  });
}

export const signpostCategories: SignpostCategory[] = buildCategories();
