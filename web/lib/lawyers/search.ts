import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { toPgVectorLiteral } from "@/lib/llm/client";
import { lawyerInclude, type LawyerWithRelations } from "@/lib/lawyers/db";
import type { AppliedFilters, ExtractedFilters } from "@/lib/agent/types";

type SearchArgs = {
  extracted: ExtractedFilters;
  applied?: AppliedFilters;
  embedding: Float32Array | null;
  keyword: string;
};

/** Provenance tags shared by both candidate kinds. */
type Source = "filter" | "vector" | "keyword" | "typesense";

/**
 * Shape of an SRA organisation candidate. Mirrors the row in `sra_organisations`
 * but only the fields the matcher needs downstream — keeps the surface narrow.
 */
export type SraOrgLite = {
  id: string;
  sraId: string;
  businessName: string;
  city: string;
  postcode: string;
  county: string;
  country: string;
  sraProfileUrl: string;
};

/**
 * Candidate row union. Distance is `null` when the candidate did not appear in
 * the ANN retrieval (it came from SQL filter or keyword only).
 */
export type Candidate =
  | {
      kind: "lawyer";
      lawyer: LawyerWithRelations;
      sources: Source[];
      cosineDistance: number | null;
    }
  | {
      kind: "org";
      org: SraOrgLite;
      sources: Source[];
      cosineDistance: number | null;
    };

const FILTER_POOL = 60;
const VECTOR_POOL = 40;
const KEYWORD_POOL = 40;
const ORG_VECTOR_POOL = 30;
const ORG_KEYWORD_POOL = 30;

export async function hybridLawyerSearch(args: SearchArgs): Promise<Candidate[]> {
  const { extracted, applied, embedding, keyword } = args;

  const lawyerCandidates = await retrieveLawyers({ extracted, applied, embedding, keyword });

  // Org candidates excluded when the user explicitly requires lawyer-only data
  // (language match or free-consultation availability — orgs carry neither).
  const includeOrgs = !applied?.language && !applied?.freeConsultation;
  const orgCandidates = includeOrgs
    ? await retrieveSraOrgs({ extracted, applied, embedding, keyword })
    : [];

  return [...lawyerCandidates, ...orgCandidates];
}

// =============================================================================
// Lawyer retrievals (unchanged behaviour from the v1 matcher)
// =============================================================================

async function retrieveLawyers(args: SearchArgs): Promise<Candidate[]> {
  const { extracted, applied, embedding, keyword } = args;
  const baseWhere = buildLawyerWhere(extracted, applied);

  const filterIds = await runFilterRetrieval(baseWhere);
  const vectorRows = embedding ? await runVectorRetrieval(embedding, baseWhere) : [];
  const keywordIds = await runKeywordRetrieval(keyword, baseWhere);

  const allIds = new Set<string>([
    ...filterIds,
    ...vectorRows.map((r) => r.id),
    ...keywordIds,
  ]);

  if (allIds.size === 0) return [];

  const lawyers = await prisma.lawyer.findMany({
    where: { id: { in: Array.from(allIds) } },
    include: lawyerInclude,
  });

  const byId = new Map(lawyers.map((l) => [l.id, l]));
  const distanceById = new Map(vectorRows.map((r) => [r.id, r.distance]));

  const filterSet = new Set(filterIds);
  const vectorSet = new Set(vectorRows.map((r) => r.id));
  const keywordSet = new Set(keywordIds);

  const out: Candidate[] = [];
  for (const id of allIds) {
    const lawyer = byId.get(id);
    if (!lawyer) continue;
    const sources: Source[] = [];
    if (filterSet.has(id)) sources.push("filter");
    if (vectorSet.has(id)) sources.push("vector");
    if (keywordSet.has(id)) sources.push("keyword");
    out.push({
      kind: "lawyer",
      lawyer,
      sources,
      cosineDistance: distanceById.get(id) ?? null,
    });
  }
  return out;
}

/**
 * Build the hard Prisma WHERE clause shared across all three lawyer retrievals.
 * Applied (sidebar) filters override extracted (agent) filters where they conflict.
 */
function buildLawyerWhere(
  extracted: ExtractedFilters,
  applied: AppliedFilters | undefined,
): Prisma.LawyerWhereInput {
  const where: Prisma.LawyerWhereInput = {};
  const ands: Prisma.LawyerWhereInput[] = [];

  const practiceSlug = applied?.practiceArea ?? extracted.practiceArea ?? null;
  if (practiceSlug) {
    ands.push({
      practiceAreas: { some: { practiceArea: { slug: practiceSlug } } },
    });
  }

  const cityFilter = applied?.city ?? extracted.city ?? null;
  if (cityFilter) {
    ands.push({
      locations: { some: { city: { equals: cityFilter, mode: "insensitive" } } },
    });
  }

  if (extracted.jurisdiction) {
    ands.push({ locations: { some: { jurisdiction: extracted.jurisdiction } } });
  }

  const lang = applied?.language ?? null;
  if (lang) {
    ands.push({
      languages: {
        some: {
          language: {
            OR: [
              { name: { equals: lang, mode: "insensitive" } },
              { code: { equals: lang.toLowerCase() } },
            ],
          },
        },
      },
    });
  }

  if (applied?.freeConsultation) {
    ands.push({ availability: { freeConsultation: true } });
  }

  if (applied?.verifiedOnly) {
    ands.push({ verifiedCredentials: true });
  }

  if (ands.length > 0) where.AND = ands;
  return where;
}

async function runFilterRetrieval(
  where: Prisma.LawyerWhereInput,
): Promise<string[]> {
  const rows = await prisma.lawyer.findMany({
    where,
    select: { id: true },
    orderBy: [{ rating: "desc" }, { yearsExperience: "desc" }],
    take: FILTER_POOL,
  });
  return rows.map((r) => r.id);
}

async function runVectorRetrieval(
  embedding: Float32Array,
  baseWhere: Prisma.LawyerWhereInput,
): Promise<{ id: string; distance: number }[]> {
  const filteredIds = baseWhere.AND
    ? (await prisma.lawyer.findMany({ where: baseWhere, select: { id: true }, take: 500 })).map((r) => r.id)
    : null;

  const literal = toPgVectorLiteral(embedding);
  if (filteredIds && filteredIds.length === 0) return [];

  const rows = filteredIds
    ? await prisma.$queryRaw<{ id: string; distance: number }[]>`
        SELECT id, (embedding <=> ${literal}::vector) AS distance
        FROM lawyers
        WHERE embedding IS NOT NULL AND id IN (${Prisma.join(filteredIds)})
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${VECTOR_POOL}
      `
    : await prisma.$queryRaw<{ id: string; distance: number }[]>`
        SELECT id, (embedding <=> ${literal}::vector) AS distance
        FROM lawyers
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${VECTOR_POOL}
      `;

  return rows;
}

async function runKeywordRetrieval(
  keyword: string,
  baseWhere: Prisma.LawyerWhereInput,
): Promise<string[]> {
  const term = keyword.trim().slice(0, 200);
  if (term.length < 2) return [];
  const rows = await prisma.lawyer.findMany({
    where: {
      AND: [
        baseWhere,
        {
          OR: [
            { bio: { contains: term, mode: "insensitive" } },
            { name: { contains: term, mode: "insensitive" } },
            {
              practiceAreas: {
                some: {
                  practiceArea: { name: { contains: term, mode: "insensitive" } },
                },
              },
            },
          ],
        },
      ],
    },
    select: { id: true },
    take: KEYWORD_POOL,
  });
  return rows.map((r) => r.id);
}

// =============================================================================
// SRA organisation retrieval (pgvector ANN + ILIKE over sra_organisations)
// =============================================================================

async function retrieveSraOrgs(args: SearchArgs): Promise<Candidate[]> {
  const { extracted, applied, embedding, keyword } = args;
  const city = applied?.city ?? extracted.city ?? null;

  const [vectorRows, keywordIds] = await Promise.all([
    embedding ? runOrgVectorRetrieval(embedding, city) : Promise.resolve([]),
    runOrgKeywordRetrieval(keyword, city),
  ]);

  const idSet = new Set<string>([...vectorRows.map((r) => r.id), ...keywordIds]);
  if (idSet.size === 0) return [];

  const rows = await prisma.sraOrganisation.findMany({
    where: { id: { in: Array.from(idSet) } },
    select: {
      id: true,
      sraId: true,
      businessName: true,
      city: true,
      postcode: true,
      county: true,
      country: true,
      sraProfileUrl: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const distanceById = new Map(vectorRows.map((r) => [r.id, r.distance]));
  const vectorSet = new Set(vectorRows.map((r) => r.id));
  const keywordSet = new Set(keywordIds);

  const out: Candidate[] = [];
  for (const id of idSet) {
    const org = byId.get(id);
    if (!org) continue;
    const sources: Source[] = [];
    if (vectorSet.has(id)) sources.push("vector");
    if (keywordSet.has(id)) sources.push("keyword");
    out.push({ kind: "org", org, sources, cosineDistance: distanceById.get(id) ?? null });
  }
  return out;
}

async function runOrgVectorRetrieval(
  embedding: Float32Array,
  city: string | null,
): Promise<{ id: string; distance: number }[]> {
  const literal = toPgVectorLiteral(embedding);
  if (city) {
    const cityPat = `%${city}%`;
    return prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, (embedding <=> ${literal}::vector) AS distance
      FROM sra_organisations
      WHERE embedding IS NOT NULL AND city ILIKE ${cityPat}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${ORG_VECTOR_POOL}
    `;
  }
  return prisma.$queryRaw<{ id: string; distance: number }[]>`
    SELECT id, (embedding <=> ${literal}::vector) AS distance
    FROM sra_organisations
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${ORG_VECTOR_POOL}
  `;
}

async function runOrgKeywordRetrieval(
  keyword: string,
  city: string | null,
): Promise<string[]> {
  const term = keyword.trim().slice(0, 200);
  if (term.length < 2) return [];
  const where: Prisma.SraOrganisationWhereInput = {
    OR: [
      { businessName: { contains: term, mode: "insensitive" } },
      { searchText: { contains: term, mode: "insensitive" } },
    ],
  };
  if (city) where.city = { contains: city, mode: "insensitive" };
  const rows = await prisma.sraOrganisation.findMany({
    where,
    select: { id: true },
    take: ORG_KEYWORD_POOL,
  });
  return rows.map((r) => r.id);
}
