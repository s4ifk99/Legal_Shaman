import "server-only";

import { fetchAllListings } from "@/lib/data";
import type { Listing } from "@/lib/data";
import { prisma } from "@/lib/db/prisma";
import { fromSraMeili } from "@/lib/legal-search/adapters/listing-adapter";
import { resolveSraPracticeAreasForDisplay } from "@/lib/search/sra-practice-areas";
import {
  legacyRowFromSearchResult,
  type LegacyGetRow,
} from "@/lib/legal-search/legacy-get-response";
import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import type { ParsedQuery } from "@/lib/legal-search/types";
import type { SearchResultSource } from "@/lib/search-events/types";

const EMPTY_PARSED: ParsedQuery = {
  rawText: "",
  intent: "find_firm",
  semanticQuery: "",
  practiceAreaSlug: null,
  location: null,
};

function listingToLegacyRow(listing: Listing): LegacyGetRow {
  const practiceAreas: string[] = [];
  if (listing.legalAidGovCategory) practiceAreas.push(listing.legalAidGovCategory);
  if (listing.subcategory) practiceAreas.push(listing.subcategory.replace(/-/g, " "));

  return {
    kind: "adl",
    id: listing.id,
    businessName: listing.businessName,
    description: listing.description,
    city: listing.city,
    postcode: listing.postcode,
    phone: listing.phone,
    email: listing.email,
    website: listing.website,
    category: listing.category,
    subcategory: listing.subcategory,
    ...(practiceAreas.length ? { practiceAreas } : {}),
    isFree: listing.isFree,
    isLegalAid: Boolean(listing.isLegalAid),
    isSponsored: listing.isSponsored,
    sources: ["lexical"],
    ...(listing.isLegalAid ? { sourceType: "legal_aid" } : {}),
  };
}

function sraOrgToDocument(org: {
  id: string;
  sraId: string;
  businessName: string;
  displayName: string;
  organisationName: string;
  tradingName: string;
  firmName: string;
  searchText: string;
  phone: string;
  city: string;
  postcode: string;
  county: string;
  country: string;
  sraProfileUrl: string;
  website: string;
  email: string;
  authorisationStatus: string;
  workArea?: unknown;
  rawPayload?: unknown;
}): SraMeiliDocument {
  return {
    id: org.id,
    sraId: org.sraId,
    businessName: org.businessName,
    displayName: org.displayName,
    organisationName: org.organisationName,
    tradingName: org.tradingName,
    firmName: org.firmName,
    searchText: org.searchText,
    phone: org.phone,
    city: org.city,
    postcode: org.postcode,
    county: org.county,
    country: org.country,
    source: "sra",
    sraProfileUrl: org.sraProfileUrl,
    website: org.website || undefined,
    email: org.email || undefined,
    authorisationStatus: org.authorisationStatus || undefined,
    ...(org.workArea != null ? { workArea: org.workArea } : {}),
    ...(org.rawPayload && typeof org.rawPayload === "object"
      ? { rawPayload: org.rawPayload as Record<string, unknown> }
      : {}),
  };
}

export async function fetchDirectoryEntity(
  entityId: string,
  resultSource: SearchResultSource,
): Promise<LegacyGetRow | null> {
  const id = entityId.trim();
  if (!id) return null;

  if (resultSource === "sra" || id.startsWith("sra:")) {
    const sraId = id.replace(/^sra:/i, "");
    const org = await prisma.sraOrganisation.findFirst({
      where: { OR: [{ sraId }, { id }] },
    });
    if (!org) return null;
    const result = fromSraMeili(sraOrgToDocument(org), EMPTY_PARSED);
    const practiceAreas = resolveSraPracticeAreasForDisplay({
      organisationName: result.title,
      searchText: org.searchText,
      workArea: org.workArea,
      rawPayload: org.rawPayload,
      existing: result.practiceAreas,
    });
    return legacyRowFromSearchResult({ ...result, practiceAreas });
  }

  const listing = fetchAllListings().find((l) => l.id === id);
  if (listing) return listingToLegacyRow(listing);

  return null;
}

export async function fetchDirectoryEntityByName(businessName: string): Promise<LegacyGetRow | null> {
  const name = businessName.trim();
  if (name.length < 2) return null;

  const listing = fetchAllListings().find(
    (l) => l.businessName.trim().toLowerCase() === name.toLowerCase(),
  );
  if (listing) return listingToLegacyRow(listing);

  const dir = await runDirectorySearch({ query: name, limit: 5, semantic: false });
  const rows = (dir.legacyRows ?? []) as LegacyGetRow[];
  const exact = rows.find((r) => r.businessName.trim().toLowerCase() === name.toLowerCase());
  return exact ?? rows[0] ?? null;
}

export async function fetchDirectoryEntities(
  keys: Array<{ entityId: string; resultSource: SearchResultSource }>,
): Promise<LegacyGetRow[]> {
  const rows: LegacyGetRow[] = [];
  for (const key of keys) {
    const row = await fetchDirectoryEntity(key.entityId, key.resultSource);
    if (row) rows.push(row);
  }
  return rows;
}
