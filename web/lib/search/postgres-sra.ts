import "server-only";

import { prisma } from "@/lib/db/prisma";
import { pickSraIndexTitle } from "@/lib/search/sra-name-fields";
import type { SraMeiliDocument } from "@/lib/search/sra-document";
import type { Prisma } from "@prisma/client";

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

/** Keyword search over synced `sra_organisations` when Meilisearch/Typesense are unavailable. */
export async function searchSraOrganisationsPostgres(
  query: string,
  options: { limit: number; city?: string },
): Promise<SraMeiliDocument[]> {
  if (!process.env.DATABASE_URL?.trim()) return [];

  const trimmed = query.trim().slice(0, 200);
  if (trimmed.length < 2) return [];

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
    console.warn("[postgres-sra] search failed:", e);
    return [];
  }
}

export function postgresSraConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
