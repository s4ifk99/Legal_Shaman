import type { PrismaClient } from "@prisma/client";
import {
  chooseSraIndexTitle,
  sraTitleSourceInputFromOrg,
} from "@/lib/search-index/sra-title-source";
import { extractFirmNameFromSraSearchText } from "@/lib/search/sra-display";

export type BackfillSraNamesResult = {
  scanned: number;
  updated: number;
};

const CONCURRENCY = 15;
const PAGE_SIZE = 500;

const orgSelect = {
  id: true,
  sraId: true,
  displayName: true,
  organisationName: true,
  tradingName: true,
  firmName: true,
  businessName: true,
  searchText: true,
  rawPayload: true,
} as const;

/**
 * Recompute display_name / business_name from stored columns + search_text
 * (for rows synced before name columns existed). Paginated to avoid loading 30k+ rows at once.
 */
export async function backfillSraOrganisationDisplayNames(
  prisma: PrismaClient,
): Promise<BackfillSraNamesResult> {
  let scanned = 0;
  let updated = 0;
  let cursor: string | undefined;

  type UpdateOp = ReturnType<PrismaClient["sraOrganisation"]["update"]>;
  const queue: UpdateOp[] = [];

  async function flush(): Promise<void> {
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    await Promise.all(batch);
  }

  while (true) {
    const rows = await prisma.sraOrganisation.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: orgSelect,
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1]!.id;

    const firms = await prisma.firm.findMany({
      where: { sraId: { in: rows.map((r) => r.sraId) } },
      select: { sraId: true, name: true },
    });
    const firmBySraId = new Map(firms.filter((f) => f.sraId).map((f) => [f.sraId!, f.name]));

    for (const org of rows) {
      scanned++;
      const { title: displayName } = chooseSraIndexTitle(
        sraTitleSourceInputFromOrg(org, firmBySraId.get(org.sraId) ?? null),
      );

      const firmLine = extractFirmNameFromSraSearchText(org.searchText, org.sraId) ?? "";

      const needsUpdate =
        displayName !== org.displayName ||
        displayName !== org.businessName ||
        isPlaceholder(org.businessName, org.sraId);

      if (!needsUpdate) continue;

      queue.push(
        prisma.sraOrganisation.update({
          where: { id: org.id },
          data: {
            displayName,
            businessName: displayName,
            organisationName: org.organisationName || firmLine || displayName,
          },
        }),
      );
      updated++;

      if (queue.length >= CONCURRENCY) {
        await flush();
        if (updated % 500 === 0) {
          console.info(JSON.stringify({ event: "sra_names_backfill_progress", updated, scanned }));
        }
      }
    }
  }

  await flush();

  return { scanned, updated };
}

function isPlaceholder(name: string, sraId: string): boolean {
  return /^Organisation\s+\d+$/i.test(name.trim()) && name.includes(sraId);
}
