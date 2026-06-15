import type { PrismaClient } from "@prisma/client";
import { enqueueProviderForIndexing } from "@/lib/ops/enqueue-on-approval";
import { rejectCandidateName } from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import type { IdentitySourceType } from "@/lib/sra/missing-identity-recovery/types";
import { isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type CleanupBadCandidatesOptions = {
  dryRun?: boolean;
  limit?: number;
};

export type CleanupBadCandidatesResult = {
  event: "sra_identity_candidates_cleanup_bad";
  dryRun: boolean;
  examined: number;
  rejected: number;
  orgsReverted: number;
  reindexQueued: number;
  samples: {
    id: string;
    sraId: string;
    candidateName: string;
    reason: string;
    orgReverted: boolean;
  }[];
};

function placeholderDisplayName(sraId: string): string {
  return `SRA organisation ${sraId}`;
}

function orgWasUpdatedFromCandidate(args: {
  displayName: string;
  organisationName: string;
  candidateName: string;
  nameRecoverySource: string | null;
  nameRecoverySourceUrl: string | null;
  sourceType: string;
  sourceUrl: string;
}): boolean {
  const name = args.candidateName.trim();
  if (!name) return false;
  const nameMatches =
    args.displayName.trim() === name || args.organisationName.trim() === name;
  if (!nameMatches) return false;

  const provUrl = args.nameRecoverySourceUrl?.trim();
  const provSource = args.nameRecoverySource?.trim();
  if (provUrl && provUrl === args.sourceUrl.trim()) return true;
  if (provSource && provSource === args.sourceType.trim()) return true;
  return nameMatches && Boolean(provSource || provUrl);
}

export async function cleanupBadIdentityCandidates(
  prisma: PrismaClient,
  opts: CleanupBadCandidatesOptions = {},
): Promise<CleanupBadCandidatesResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = Math.max(1, opts.limit ?? 500);

  const result: CleanupBadCandidatesResult = {
    event: "sra_identity_candidates_cleanup_bad",
    dryRun,
    examined: 0,
    rejected: 0,
    orgsReverted: 0,
    reindexQueued: 0,
    samples: [],
  };

  const rows = await prisma.sraIdentityCandidate.findMany({
    where: { status: "auto_approved", candidateName: { not: "" } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      organisation: {
        select: {
          id: true,
          sraId: true,
          displayName: true,
          organisationName: true,
          nameRecoverySource: true,
          nameRecoverySourceUrl: true,
        },
      },
    },
  });

  result.examined = rows.length;

  for (const row of rows) {
    const reject = rejectCandidateName(row.candidateName, {
      sourceType: row.sourceType as IdentitySourceType,
      sourceUrl: row.sourceUrl,
    });
    if (!reject.rejected) continue;

    const reason = reject.reason;
    const org = row.organisation;
    const shouldRevert =
      org &&
      orgWasUpdatedFromCandidate({
        displayName: org.displayName,
        organisationName: org.organisationName,
        candidateName: row.candidateName,
        nameRecoverySource: org.nameRecoverySource,
        nameRecoverySourceUrl: org.nameRecoverySourceUrl,
        sourceType: row.sourceType,
        sourceUrl: row.sourceUrl,
      });

    if (result.samples.length < 15) {
      result.samples.push({
        id: row.id,
        sraId: row.sraId,
        candidateName: row.candidateName,
        reason,
        orgReverted: Boolean(shouldRevert),
      });
    }

    if (dryRun) {
      result.rejected++;
      if (shouldRevert) result.orgsReverted++;
      continue;
    }

    await prisma.sraIdentityCandidate.update({
      where: { id: row.id },
      data: { status: "rejected", rejectReason: `cleanup_bad:${reason}` },
    });
    result.rejected++;

    if (shouldRevert && org) {
      const revertName = placeholderDisplayName(org.sraId);
      await prisma.sraOrganisation.update({
        where: { id: org.id },
        data: {
          displayName: revertName,
          organisationName: isPlaceholderSraDisplayName(org.organisationName, org.sraId)
            ? org.organisationName
            : revertName,
          nameRecoverySource: null,
          nameRecoverySourceUrl: null,
          nameRecoveryConfidence: null,
          nameRecoveryFetchedAt: null,
        },
      });
      result.orgsReverted++;

      await enqueueProviderForIndexing({
        entityId: `sra:${org.sraId}`,
        entityType: "sra_organisation",
        reason: "sra_identity_cleanup_bad",
      });
      result.reindexQueued++;
    }
  }

  return result;
}
