import "server-only";

import { prisma } from "@/lib/db/prisma";
import { pickSraIndexTitle } from "@/lib/search/sra-name-fields";
import type { SraMeiliDocument } from "@/lib/search/sra-document";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaSql } from "@prisma/client";

const FTS_DOCUMENT_SQL = PrismaSql.sql`
  coalesce(business_name, '') || ' ' ||
  coalesce(display_name, '') || ' ' ||
  coalesce(organisation_name, '') || ' ' ||
  coalesce(trading_name, '') || ' ' ||
  coalesce(firm_name, '') || ' ' ||
  coalesce(search_text, '') || ' ' ||
  coalesce(city, '') || ' ' ||
  coalesce(county, '')
`;

type SraOrgRow = {
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
  rank?: number;
};

const SEARCH_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "was",
  "one",
  "our",
  "out",
  "get",
  "has",
  "how",
  "new",
  "now",
  "see",
  "who",
  "way",
  "may",
  "she",
  "use",
  "any",
  "his",
  "her",
  "had",
  "have",
  "this",
  "that",
  "with",
  "from",
  "they",
  "been",
  "into",
  "than",
  "when",
  "what",
  "your",
  "will",
  "would",
  "could",
  "should",
  "about",
  "after",
  "also",
  "just",
  "more",
  "some",
  "very",
  "need",
  "want",
  "help",
  "find",
  "looking",
  "please",
  "hire",
  "good",
  "best",
  "cheap",
  "local",
  "near",
  "someone",
  "lawyer",
  "lawyers",
  "solicitor",
  "solicitors",
  "attorney",
  "firm",
  "firms",
  "legal",
  "advice",
  "law",
  "nearme",
]);

function tokenizeForSearch(query: string): string[] {
  const raw = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !SEARCH_STOPWORDS.has(t));
  return [...new Set(raw)];
}

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

function buildWhereClause(
  terms: string[],
  city?: string,
): Prisma.SraOrganisationWhereInput {
  const fieldMatch = (term: string): Prisma.SraOrganisationWhereInput => ({
    OR: [
      { businessName: { contains: term, mode: "insensitive" } },
      { displayName: { contains: term, mode: "insensitive" } },
      { searchText: { contains: term, mode: "insensitive" } },
      { city: { contains: term, mode: "insensitive" } },
      { postcode: { contains: term, mode: "insensitive" } },
      { county: { contains: term, mode: "insensitive" } },
    ],
  });

  const andParts: Prisma.SraOrganisationWhereInput[] = [];

  if (city && city.length > 1) {
    andParts.push({
      OR: [
        { city: { contains: city, mode: "insensitive" } },
        { county: { contains: city, mode: "insensitive" } },
        { searchText: { contains: city, mode: "insensitive" } },
      ],
    });
  }

  if (terms.length === 0) {
    return andParts.length ? { AND: andParts } : {};
  }

  if (terms.length === 1) {
    andParts.push(fieldMatch(terms[0]!));
  } else {
    andParts.push({ OR: terms.map((t) => fieldMatch(t)) });
  }

  return andParts.length === 1 ? andParts[0]! : { AND: andParts };
}

function scoreRow(
  row: {
    businessName: string;
    displayName: string;
    searchText: string;
    city: string;
  },
  terms: string[],
  city?: string,
): number {
  const hay = `${row.businessName} ${row.displayName} ${row.searchText} ${row.city}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (row.businessName.toLowerCase().includes(term)) score += 12;
    if (row.displayName.toLowerCase().includes(term)) score += 10;
    if (row.city.toLowerCase().includes(term)) score += 6;
    if (hay.includes(term)) score += 4;
  }
  if (city && row.city.toLowerCase().includes(city.toLowerCase())) score += 8;
  if (/\bsolicitor/i.test(row.businessName)) score += 5;
  return score;
}

async function searchSraOrganisationsFts(
  query: string,
  options: { limit: number; city?: string },
): Promise<SraMeiliDocument[]> {
  const trimmed = query.trim().slice(0, 200);
  if (trimmed.length < 2) return [];

  const city = options.city?.trim();
  const take = Math.min(200, Math.max(1, options.limit * 3));
  const cityFilter =
    city && city.length > 1
      ? PrismaSql.sql`AND (
          city ILIKE ${`%${city}%`}
          OR county ILIKE ${`%${city}%`}
          OR search_text ILIKE ${`%${city}%`}
        )`
      : PrismaSql.empty;

  const rows = await prisma.$queryRaw<SraOrgRow[]>`
    SELECT
      id,
      sra_id AS "sraId",
      business_name AS "businessName",
      display_name AS "displayName",
      organisation_name AS "organisationName",
      trading_name AS "tradingName",
      firm_name AS "firmName",
      search_text AS "searchText",
      phone,
      city,
      postcode,
      county,
      country,
      sra_profile_url AS "sraProfileUrl",
      ts_rank(
        to_tsvector('english', ${FTS_DOCUMENT_SQL}),
        websearch_to_tsquery('english', ${trimmed})
      )::float8 AS rank
    FROM sra_organisations
    WHERE to_tsvector('english', ${FTS_DOCUMENT_SQL})
      @@ websearch_to_tsquery('english', ${trimmed})
    ${cityFilter}
    ORDER BY rank DESC, business_name ASC
    LIMIT ${take}
  `;

  const limit = Math.min(120, Math.max(1, options.limit));
  return rows.slice(0, limit).map((row) => rowToMeiliDoc(row));
}

/** Keyword search over synced `sra_organisations` (Postgres FTS with ILIKE fallback). */
export async function searchSraOrganisationsPostgres(
  query: string,
  options: { limit: number; city?: string },
): Promise<SraMeiliDocument[]> {
  if (!process.env.DATABASE_URL?.trim()) return [];

  const trimmed = query.trim().slice(0, 200);
  if (trimmed.length < 2) return [];

  try {
    const ftsHits = await searchSraOrganisationsFts(trimmed, options);
    if (ftsHits.length > 0) return ftsHits;
  } catch (e) {
    console.warn("[postgres-sra] FTS search failed, falling back to ILIKE:", e);
  }

  const terms = tokenizeForSearch(trimmed);
  const city = options.city?.trim();
  const where = buildWhereClause(terms, city);

  try {
    const take = Math.min(200, Math.max(1, options.limit * 3));
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
      take,
      orderBy: { businessName: "asc" },
    });

    const limit = Math.min(120, Math.max(1, options.limit));
    return rows
      .map((row) => ({
        doc: rowToMeiliDoc(row),
        score: scoreRow(row, terms.length ? terms : [trimmed.toLowerCase()], city),
      }))
      .sort((a, b) => b.score - a.score || a.doc.businessName.localeCompare(b.doc.businessName))
      .slice(0, limit)
      .map((r) => r.doc);
  } catch (e) {
    console.warn("[postgres-sra] ILIKE search failed:", e);
    return [];
  }
}

export function postgresSraConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
