import { Prisma, type PrismaClient } from "@prisma/client";

export type SraLogicalDuplicateRow = {
  sraId: string;
  displayName: string;
  organisationName: string;
  postcode: string;
  phone: string;
  website: string;
  email: string;
};

export type SraLogicalDuplicateExample = {
  reason: string;
  matchKey: string;
  rows: SraLogicalDuplicateRow[];
};

export type SraLogicalDuplicateReport = {
  totalRows: number;
  exactSraIdDuplicates: number;
  logicalDuplicateGroups: number;
  suspectedLegacyIdRows: number;
  suspectedSraNumberRows: number;
  placeholderMatchedToRealName: number;
  examples: SraLogicalDuplicateExample[];
};

type CountRow = { count: bigint };
type GroupKeyRow = { match_key: string };

const DEFAULT_EXAMPLE_GROUPS = 8;
const ROWS_PER_EXAMPLE = 6;

const NP = `UPPER(REPLACE(TRIM(postcode), ' ', ''))`;
const NN = `LOWER(TRIM(COALESCE(NULLIF(organisation_name, ''), display_name)))`;
const NPHONE = `NULLIF(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), '')`;
const NDOMAIN = `LOWER(NULLIF(SPLIT_PART(REGEXP_REPLACE(website, '^https?://(www\\.)?', '', 'i'), '/', 1), ''))`;
const NEMAIL = `LOWER(NULLIF(TRIM(email), ''))`;
const ADDR = `LOWER(NULLIF(TRIM(COALESCE(offices->0->>'address1', offices->0->>'Address1', '')), ''))`;
const PNP = NP.replace(/postcode/g, "p.postcode");
const RNP = NP.replace(/postcode/g, "r.postcode");
const PADDR = ADDR.replace(/offices/g, "p.offices");
const RADDR = `LOWER(NULLIF(TRIM(COALESCE(r.offices->0->>'address1', r.offices->0->>'Address1', '')), ''))`;

const LOGICAL_CHECKS: { reason: string; countSql: string; keysSql: string }[] = [
  {
    reason: "same_normalised_name_and_postcode",
    countSql: `
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT ${NN}, ${NP} FROM sra_organisations
        WHERE ${NN} != '' AND ${NP} != ''
        GROUP BY 1, 2 HAVING COUNT(DISTINCT sra_id) > 1
      ) g`,
    keysSql: `
      SELECT (${NN} || '|' || ${NP}) AS match_key
      FROM sra_organisations
      WHERE ${NN} != '' AND ${NP} != ''
      GROUP BY 1 HAVING COUNT(DISTINCT sra_id) > 1
      ORDER BY COUNT(DISTINCT sra_id) DESC, match_key`,
  },
  {
    reason: "same_phone_and_postcode",
    countSql: `
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT ${NPHONE}, ${NP} FROM sra_organisations
        WHERE ${NPHONE} IS NOT NULL AND ${NP} != ''
        GROUP BY 1, 2 HAVING COUNT(DISTINCT sra_id) > 1
      ) g`,
    keysSql: `
      SELECT (${NPHONE} || '|' || ${NP}) AS match_key
      FROM sra_organisations
      WHERE ${NPHONE} IS NOT NULL AND ${NP} != ''
      GROUP BY 1 HAVING COUNT(DISTINCT sra_id) > 1
      ORDER BY COUNT(DISTINCT sra_id) DESC, match_key`,
  },
  {
    reason: "same_website_domain",
    countSql: `
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT ${NDOMAIN} FROM sra_organisations
        WHERE ${NDOMAIN} IS NOT NULL
        GROUP BY 1 HAVING COUNT(DISTINCT sra_id) > 1
      ) g`,
    keysSql: `
      SELECT ${NDOMAIN} AS match_key
      FROM sra_organisations
      WHERE ${NDOMAIN} IS NOT NULL
      GROUP BY 1 HAVING COUNT(DISTINCT sra_id) > 1
      ORDER BY COUNT(DISTINCT sra_id) DESC, match_key`,
  },
  {
    reason: "same_email",
    countSql: `
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT ${NEMAIL} FROM sra_organisations
        WHERE ${NEMAIL} IS NOT NULL
        GROUP BY 1 HAVING COUNT(DISTINCT sra_id) > 1
      ) g`,
    keysSql: `
      SELECT ${NEMAIL} AS match_key
      FROM sra_organisations
      WHERE ${NEMAIL} IS NOT NULL
      GROUP BY 1 HAVING COUNT(DISTINCT sra_id) > 1
      ORDER BY COUNT(DISTINCT sra_id) DESC, match_key`,
  },
  {
    reason: "same_first_office_address_and_postcode",
    countSql: `
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT ${ADDR}, ${NP} FROM sra_organisations
        WHERE ${ADDR} IS NOT NULL AND ${NP} != ''
        GROUP BY 1, 2 HAVING COUNT(DISTINCT sra_id) > 1
      ) g`,
    keysSql: `
      SELECT (${ADDR} || '|' || ${NP}) AS match_key
      FROM sra_organisations
      WHERE ${ADDR} IS NOT NULL AND ${NP} != ''
      GROUP BY 1 HAVING COUNT(DISTINCT sra_id) > 1
      ORDER BY COUNT(DISTINCT sra_id) DESC, match_key`,
  },
  {
    reason: "placeholder_address_matches_real_name_row",
    countSql: `
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT (${PNP} || '|' || COALESCE(NULLIF(LOWER(TRIM(p.city)), ''), ${PADDR}, '')) AS match_key
        FROM sra_organisations p
        INNER JOIN sra_organisations r
          ON r.display_name NOT LIKE 'SRA organisation%'
         AND ${PNP} = ${RNP} AND ${PNP} != ''
         AND (
           (LOWER(TRIM(p.city)) = LOWER(TRIM(r.city)) AND TRIM(p.city) != '')
           OR (${PADDR} = ${RADDR} AND ${PADDR} IS NOT NULL)
         )
        WHERE p.display_name LIKE 'SRA organisation%'
        GROUP BY 1
      ) g`,
    keysSql: `
      SELECT (${PNP} || '|' || COALESCE(NULLIF(LOWER(TRIM(p.city)), ''), ${PADDR}, '')) AS match_key
      FROM sra_organisations p
      INNER JOIN sra_organisations r
        ON r.display_name NOT LIKE 'SRA organisation%'
       AND ${PNP} = ${RNP} AND ${PNP} != ''
       AND (
         (LOWER(TRIM(p.city)) = LOWER(TRIM(r.city)) AND TRIM(p.city) != '')
         OR (${PADDR} = ${RADDR} AND ${PADDR} IS NOT NULL)
       )
      WHERE p.display_name LIKE 'SRA organisation%'
      GROUP BY 1
      ORDER BY COUNT(DISTINCT p.sra_id) DESC, match_key`,
  },
];

async function fetchRowsForKey(
  prisma: PrismaClient,
  reason: string,
  matchKey: string,
): Promise<SraLogicalDuplicateRow[]> {
  switch (reason) {
    case "same_normalised_name_and_postcode": {
      const [name, pc] = matchKey.split("|");
      return prisma.$queryRaw<SraLogicalDuplicateRow[]>`
        SELECT sra_id AS "sraId", display_name AS "displayName", organisation_name AS "organisationName",
               postcode, phone, website, email
        FROM sra_organisations
        WHERE ${Prisma.raw(NN)} = ${name} AND ${Prisma.raw(NP)} = ${pc}
        ORDER BY sra_id LIMIT ${ROWS_PER_EXAMPLE}
      `;
    }
    case "same_phone_and_postcode": {
      const [phone, pc] = matchKey.split("|");
      return prisma.$queryRaw<SraLogicalDuplicateRow[]>`
        SELECT sra_id AS "sraId", display_name AS "displayName", organisation_name AS "organisationName",
               postcode, phone, website, email
        FROM sra_organisations
        WHERE ${Prisma.raw(NPHONE)} = ${phone} AND ${Prisma.raw(NP)} = ${pc}
        ORDER BY sra_id LIMIT ${ROWS_PER_EXAMPLE}
      `;
    }
    case "same_website_domain":
      return prisma.$queryRaw<SraLogicalDuplicateRow[]>`
        SELECT sra_id AS "sraId", display_name AS "displayName", organisation_name AS "organisationName",
               postcode, phone, website, email
        FROM sra_organisations
        WHERE ${Prisma.raw(NDOMAIN)} = ${matchKey}
        ORDER BY sra_id LIMIT ${ROWS_PER_EXAMPLE}
      `;
    case "same_email":
      return prisma.$queryRaw<SraLogicalDuplicateRow[]>`
        SELECT sra_id AS "sraId", display_name AS "displayName", organisation_name AS "organisationName",
               postcode, phone, website, email
        FROM sra_organisations
        WHERE ${Prisma.raw(NEMAIL)} = ${matchKey}
        ORDER BY sra_id LIMIT ${ROWS_PER_EXAMPLE}
      `;
    case "same_first_office_address_and_postcode": {
      const [address, pc] = matchKey.split("|");
      return prisma.$queryRaw<SraLogicalDuplicateRow[]>`
        SELECT sra_id AS "sraId", display_name AS "displayName", organisation_name AS "organisationName",
               postcode, phone, website, email
        FROM sra_organisations
        WHERE ${Prisma.raw(ADDR)} = ${address} AND ${Prisma.raw(NP)} = ${pc}
        ORDER BY sra_id LIMIT ${ROWS_PER_EXAMPLE}
      `;
    }
    case "placeholder_address_matches_real_name_row": {
      const [pc, loc] = matchKey.split("|");
      return prisma.$queryRaw<SraLogicalDuplicateRow[]>`
        (
          SELECT p.sra_id AS "sraId", p.display_name AS "displayName", p.organisation_name AS "organisationName",
                 p.postcode, p.phone, p.website, p.email
          FROM sra_organisations p
          WHERE p.display_name LIKE 'SRA organisation%'
            AND ${Prisma.raw(PNP)} = ${pc}
            AND (LOWER(TRIM(p.city)) = ${loc} OR ${Prisma.raw(PADDR)} = ${loc})
          ORDER BY p.sra_id LIMIT ${ROWS_PER_EXAMPLE}
        )
        UNION ALL
        (
          SELECT r.sra_id, r.display_name, r.organisation_name, r.postcode, r.phone, r.website, r.email
          FROM sra_organisations r
          WHERE r.display_name NOT LIKE 'SRA organisation%'
            AND ${Prisma.raw(RNP)} = ${pc}
            AND (LOWER(TRIM(r.city)) = ${loc} OR ${Prisma.raw(RADDR)} = ${loc})
          ORDER BY r.sra_id LIMIT ${ROWS_PER_EXAMPLE}
        )
      `;
    }
    default:
      return [];
  }
}

export async function auditSraLogicalDuplicates(
  prisma: PrismaClient,
  options?: { exampleLimit?: number },
): Promise<SraLogicalDuplicateReport> {
  const exampleLimit = options?.exampleLimit ?? DEFAULT_EXAMPLE_GROUPS;

  const [totalRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count FROM sra_organisations
  `;
  const totalRows = Number(totalRow?.count ?? 0);

  const [exactDup] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count
    FROM (SELECT sra_id FROM sra_organisations GROUP BY sra_id HAVING COUNT(*) > 1) d
  `;
  const exactSraIdDuplicates = Number(exactDup?.count ?? 0);

  const [legacyRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count FROM sra_organisations
    WHERE raw_payload IS NOT NULL
      AND sra_id = (raw_payload->>'Id')
      AND sra_id IS DISTINCT FROM (raw_payload->>'SraNumber')
  `;
  const suspectedLegacyIdRows = Number(legacyRow?.count ?? 0);

  const [sraNumberRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count FROM sra_organisations
    WHERE raw_payload IS NOT NULL AND sra_id = (raw_payload->>'SraNumber')
  `;
  const suspectedSraNumberRows = Number(sraNumberRow?.count ?? 0);

  const [placeholderMatch] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT p.sra_id)::bigint AS count
    FROM sra_organisations p
    INNER JOIN sra_organisations r
      ON r.display_name NOT LIKE 'SRA organisation%'
     AND ${Prisma.raw(PNP)} = ${Prisma.raw(RNP)}
     AND ${Prisma.raw(PNP)} != ''
     AND (
       (LOWER(TRIM(p.city)) = LOWER(TRIM(r.city)) AND TRIM(p.city) != '')
       OR (${Prisma.raw(PADDR)} = ${Prisma.raw(RADDR)} AND ${Prisma.raw(PADDR)} IS NOT NULL)
     )
    WHERE p.display_name LIKE 'SRA organisation%'
  `;
  const placeholderMatchedToRealName = Number(placeholderMatch?.count ?? 0);

  let logicalDuplicateGroups = 0;
  const examples: SraLogicalDuplicateExample[] = [];

  for (const check of LOGICAL_CHECKS) {
    const [countRow] = await prisma.$queryRawUnsafe<CountRow[]>(check.countSql.trim());
    logicalDuplicateGroups += Number(countRow?.count ?? 0);

    const keyRows = await prisma.$queryRawUnsafe<GroupKeyRow[]>(
      `${check.keysSql.trim()} LIMIT ${exampleLimit}`,
    );
    for (const { match_key: matchKey } of keyRows) {
      const rows = await fetchRowsForKey(prisma, check.reason, matchKey);
      if (rows.length === 0) continue;
      examples.push({ reason: check.reason, matchKey, rows });
    }
  }

  return {
    totalRows,
    exactSraIdDuplicates,
    logicalDuplicateGroups,
    suspectedLegacyIdRows,
    suspectedSraNumberRows,
    placeholderMatchedToRealName,
    examples,
  };
}
