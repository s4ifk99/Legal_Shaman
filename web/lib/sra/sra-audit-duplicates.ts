import type { PrismaClient } from "@prisma/client";

export type SraDuplicateAuditExample = {
  sraId: string;
  rowCount: number;
  displayNames: string[];
};

export type SraDuplicateAuditReport = {
  totalRows: number;
  distinctSraIds: number;
  duplicateSraIds: number;
  duplicateRowCount: number;
  examples: SraDuplicateAuditExample[];
};

type CountRow = { count: bigint };
type DuplicateGroupRow = {
  sra_id: string;
  row_count: bigint;
  display_names: string[] | null;
};

const DEFAULT_EXAMPLE_LIMIT = 10;

/**
 * Find duplicate `sra_id` rows via aggregate queries (no full-table load).
 */
export async function auditSraDuplicateIds(
  prisma: PrismaClient,
  options?: { exampleLimit?: number },
): Promise<SraDuplicateAuditReport> {
  const exampleLimit = options?.exampleLimit ?? DEFAULT_EXAMPLE_LIMIT;

  const [totalRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count FROM sra_organisations
  `;
  const [distinctRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT sra_id)::bigint AS count FROM sra_organisations
  `;

  const totalRows = Number(totalRow?.count ?? 0);
  const distinctSraIds = Number(distinctRow?.count ?? 0);

  const [dupStats] = await prisma.$queryRaw<
    { duplicate_sra_ids: bigint; duplicate_row_count: bigint }[]
  >`
    SELECT
      COUNT(*)::bigint AS duplicate_sra_ids,
      COALESCE(SUM(row_count - 1), 0)::bigint AS duplicate_row_count
    FROM (
      SELECT sra_id, COUNT(*)::bigint AS row_count
      FROM sra_organisations
      GROUP BY sra_id
      HAVING COUNT(*) > 1
    ) dup
  `;

  const duplicateSraIds = Number(dupStats?.duplicate_sra_ids ?? 0);
  const duplicateRowCount = Number(dupStats?.duplicate_row_count ?? 0);

  const examples =
    duplicateSraIds > 0
      ? (
          await prisma.$queryRaw<DuplicateGroupRow[]>`
            SELECT
              sra_id,
              COUNT(*)::bigint AS row_count,
              array_agg(display_name ORDER BY display_name) AS display_names
            FROM sra_organisations
            GROUP BY sra_id
            HAVING COUNT(*) > 1
            ORDER BY row_count DESC, sra_id
            LIMIT ${exampleLimit}
          `
        ).map((row) => ({
          sraId: row.sra_id,
          rowCount: Number(row.row_count),
          displayNames: (row.display_names ?? []).filter(Boolean),
        }))
      : [];

  return {
    totalRows,
    distinctSraIds,
    duplicateSraIds,
    duplicateRowCount,
    examples,
  };
}
