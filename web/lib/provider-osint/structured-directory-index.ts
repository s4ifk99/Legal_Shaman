import legalAidListingsRaw from "@/data/legal-aid-listings.json";
import probonoData from "@/data/probono-sources.json";
import { listings as curatedListings } from "@/lib/data";
import {
  cityMatches,
  nameSimilarity,
  postcodeMatches,
} from "@/lib/provider-osint/name-normalize";
import type { StructuredDirectoryMatch } from "@/lib/provider-osint/types";
import type { EnrichmentSourceType } from "@/lib/provider-enrichment/types";

type DirectoryRow = {
  title: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  postcode?: string;
  city?: string;
  practiceAreas?: string[];
  openingHours?: string;
  legalAid?: boolean;
  freeConsultation?: boolean;
  sourceUrl: string;
  sourceType: EnrichmentSourceType;
};

const MIN_NAME_SIMILARITY = 0.55;
const MIN_NAME_WITH_POSTCODE = 0.4;

function buildIndex(): DirectoryRow[] {
  const rows: DirectoryRow[] = [];

  const laList = Array.isArray(legalAidListingsRaw)
    ? legalAidListingsRaw
    : (legalAidListingsRaw as { listings?: typeof legalAidListingsRaw }).listings ?? [];

  for (const l of laList as {
    businessName?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    postcode?: string;
    city?: string;
    legalAidGovCategory?: string;
    subcategory?: string;
  }[]) {
    if (!l.businessName) continue;
    rows.push({
      title: l.businessName,
      phone: l.phone,
      email: l.email,
      website: l.website,
      address: l.address,
      postcode: l.postcode,
      city: l.city,
      practiceAreas: [l.legalAidGovCategory, l.subcategory?.replace(/-/g, " ")].filter(
        Boolean,
      ) as string[],
      legalAid: true,
      sourceUrl: "https://www.gov.uk/legal-aid/search-for-legal-advice",
      sourceType: "govuk_legal_aid",
    });
  }

  const probono = (probonoData as { sources: Record<string, unknown>[] }).sources ?? [];
  for (const p of probono) {
    const title = String(p.title ?? "");
    if (!title) continue;
    rows.push({
      title,
      phone: typeof p.phone === "string" ? p.phone : undefined,
      email: typeof p.email === "string" ? p.email : undefined,
      website: typeof p.website === "string" ? p.website : undefined,
      address: typeof p.address === "string" ? p.address : undefined,
      postcode: typeof p.postcode === "string" ? p.postcode : undefined,
      city: typeof p.city === "string" ? p.city : undefined,
      practiceAreas: Array.isArray(p.practiceAreas)
        ? (p.practiceAreas as string[])
        : undefined,
      openingHours: typeof p.openingHours === "string" ? p.openingHours : undefined,
      legalAid: p.entityType === "law_centre",
      freeConsultation: true,
      sourceUrl:
        typeof p.sourceUrl === "string"
          ? p.sourceUrl
          : typeof p.website === "string"
            ? p.website
            : "https://www.lawworks.org.uk/",
      sourceType: "curated_source",
    });
  }

  for (const c of curatedListings) {
    if (c.isLegalAid) continue;
    rows.push({
      title: c.businessName,
      phone: c.phone,
      email: c.email,
      website: c.website,
      address: c.address,
      postcode: c.postcode,
      city: c.city,
      practiceAreas: [c.category, c.subcategory?.replace(/-/g, " ")].filter(Boolean) as string[],
      freeConsultation: c.isFree,
      sourceUrl: c.website ?? `curated:${c.id}`,
      sourceType: "curated_source",
    });
  }

  return rows;
}

let cachedIndex: DirectoryRow[] | null = null;

export function getStructuredDirectoryIndex(): DirectoryRow[] {
  if (!cachedIndex) cachedIndex = buildIndex();
  return cachedIndex;
}

export function matchStructuredDirectories(args: {
  title: string;
  postcode?: string;
  city?: string;
  limit?: number;
}): StructuredDirectoryMatch[] {
  const index = getStructuredDirectoryIndex();
  const scored: StructuredDirectoryMatch[] = [];

  for (const row of index) {
    const sim = nameSimilarity(args.title, row.title);
    const pc = postcodeMatches(args.postcode, row.postcode);
    const city = cityMatches(args.city, row.city);
    const threshold = pc || city ? MIN_NAME_WITH_POSTCODE : MIN_NAME_SIMILARITY;
    if (sim < threshold) continue;

    let confidence = 0.5 + sim * 0.35;
    if (pc) confidence += 0.12;
    if (city) confidence += 0.05;
    confidence = Math.min(0.96, Math.round(confidence * 100) / 100);

    scored.push({
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      provenanceNote: `Structured directory match "${row.title}" (similarity=${sim.toFixed(2)}${pc ? ", postcode" : ""})`,
      confidence,
      title: row.title,
      phone: row.phone,
      email: row.email,
      website: row.website,
      address: row.address,
      postcode: row.postcode,
      city: row.city,
      practiceAreas: row.practiceAreas,
      openingHours: row.openingHours,
      legalAid: row.legalAid,
      freeConsultation: row.freeConsultation,
    });
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, args.limit ?? 3);
}
