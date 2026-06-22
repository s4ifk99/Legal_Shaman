import "server-only";

import { prisma } from "@/lib/db/prisma";
import { pickSraIndexTitle } from "@/lib/search/sra-name-fields";
import type { SraMeiliDocument } from "@/lib/search/sra-document";

function rowToMeiliDoc(row: {
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
}): SraMeiliDocument {
  const businessName = pickSraIndexTitle(row.sraId, row.searchText, {
    displayName: row.displayName,
    organisationName: row.organisationName,
    tradingName: row.tradingName,
    firmName: row.firmName,
    businessName: row.businessName,
  });
  return {
    id: row.id,
    businessName,
    displayName: row.displayName || businessName,
    organisationName: row.organisationName,
    tradingName: row.tradingName,
    firmName: row.firmName,
    searchText: row.searchText,
    sraId: row.sraId,
    phone: row.phone,
    city: row.city,
    postcode: row.postcode,
    county: row.county,
    country: row.country,
    source: "sra",
    sraProfileUrl: row.sraProfileUrl,
  };
}

/** Keyword search over synced `sra_organisations` when Meilisearch/Typesense are unavailable. */
export async function searchSraOrganisationsPostgres(
  query: string,
  options: { limit: number; city?: string },
): Promise<SraMeiliDocument[]> {
  if (!process.env.DATABASE_URL?.trim()) return [];

  const term = query.trim().slice(0, 200);
  if (term.length < 2) return [];

  const city = options.city?.trim();
  const where = {
    OR: [
      { businessName: { contains: term, mode: "insensitive" as const } },
      { displayName: { contains: term, mode: "insensitive" as const } },
      { searchText: { contains: term, mode: "insensitive" as const } },
      { city: { contains: term, mode: "insensitive" as const } },
    ],
    ...(city && city.length > 1
      ? { city: { contains: city, mode: "insensitive" as const } }
      : {}),
  };

  try {
    const rows = await prisma.sraOrganisation.findMany({
      where,
      select: {
        id: true,
        sraId: true,
        businessName: true,
        displayName: true,
        organisationName: true,
        tradingName: true,
        firmName: true,
        searchText: true,
        phone: true,
        city: true,
        postcode: true,
        county: true,
        country: true,
        sraProfileUrl: true,
      },
      take: Math.min(120, Math.max(1, options.limit)),
      orderBy: { businessName: "asc" },
    });
    return rows.map(rowToMeiliDoc);
  } catch (e) {
    console.warn("[postgres-sra] search failed:", e);
    return [];
  }
}

export function postgresSraConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
