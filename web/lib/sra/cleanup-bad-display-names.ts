import type { PrismaClient } from "@prisma/client";
import { enqueueProviderForIndexing } from "@/lib/ops/enqueue-on-approval";
import { isBadRecoveredDisplayName } from "@/lib/provider-osint/firm-name-seed-validation";
import { isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type CleanupBadDisplayNamesOptions = {
  dryRun?: boolean;
  limit?: number;
};

export type CleanupBadDisplayNamesResult = {
  event: "sra_cleanup_bad_display_names";
  dryRun: boolean;
  examined: number;
  reverted: number;
  reindexQueued: number;
  samples: { sraId: string; displayName: string; detail: string }[];
};

function placeholderDisplayName(sraId: string): string {
  return `SRA organisation ${sraId}`;
}

function hasRecoveryProvenance(row: {
  nameRecoverySource: string | null;
  nameRecoverySourceUrl: string | null;
}): boolean {
  return Boolean(row.nameRecoverySource?.trim() || row.nameRecoverySourceUrl?.trim());
}

export async function cleanupBadRecoveredDisplayNames(
  prisma: PrismaClient,
  opts: CleanupBadDisplayNamesOptions = {},
): Promise<CleanupBadDisplayNamesResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = Math.max(1, opts.limit ?? 2000);

  const result: CleanupBadDisplayNamesResult = {
    event: "sra_cleanup_bad_display_names",
    dryRun,
    examined: 0,
    reverted: 0,
    reindexQueued: 0,
    samples: [],
  };

  const rows = await prisma.sraOrganisation.findMany({
    where: {
      OR: [
        { nameRecoverySource: { not: null } },
        { nameRecoverySourceUrl: { not: null } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      sraId: true,
      displayName: true,
      organisationName: true,
      nameRecoverySource: true,
      nameRecoverySourceUrl: true,
    },
  });

  result.examined = rows.length;

  for (const row of rows) {
    if (!hasRecoveryProvenance(row)) continue;
    if (isPlaceholderSraDisplayName(row.displayName, row.sraId)) continue;
    if (!isBadRecoveredDisplayName(row.displayName, row.sraId)) continue;

    const detail = row.displayName.trim();
    if (result.samples.length < 20) {
      result.samples.push({ sraId: row.sraId, displayName: row.displayName, detail });
    }

    if (dryRun) {
      result.reverted++;
      continue;
    }

    const revertName = placeholderDisplayName(row.sraId);
    const orgNameWasBad =
      row.organisationName.trim() === row.displayName.trim() ||
      isBadRecoveredDisplayName(row.organisationName, row.sraId);

    await prisma.sraOrganisation.update({
      where: { id: row.id },
      data: {
        displayName: revertName,
        organisationName: orgNameWasBad ? revertName : row.organisationName,
        nameRecoverySource: null,
        nameRecoverySourceUrl: null,
        nameRecoveryConfidence: null,
        nameRecoveryFetchedAt: null,
      },
    });
    result.reverted++;

    await enqueueProviderForIndexing({
      entityId: `sra:${row.sraId}`,
      entityType: "sra_organisation",
      reason: "sra_cleanup_bad_display_name",
    });
    result.reindexQueued++;
  }

  return result;
}
