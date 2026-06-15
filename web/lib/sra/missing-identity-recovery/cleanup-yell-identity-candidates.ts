import type { PrismaClient } from "@prisma/client";
import { enqueueProviderForIndexing } from "@/lib/ops/enqueue-on-approval";
import {
  isYellCategoryHeading,
  rejectCandidateName,
} from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import { isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type CleanupYellIdentityOptions = {
  dryRun?: boolean;
  limit?: number;
};

export type CleanupYellIdentityResult = {
  event: "sra_identity_candidates_cleanup_yell";
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

const YELL_NEAR_ME_CATEGORY_RE =
  /\b(solicitors?\s+near\s+me|employment\s+solicitors?\s+near\s+me|conveyancing\s+solicitors?\s+near\s+me|family\s+solicitors?\s+near\s+me)\b/i;

function placeholderDisplayName(sraId: string): string {
  return `SRA organisation ${sraId}`;
}

export function yellIdentityRejectReason(
  candidateName: string,
  sourceUrl: string,
): string {
  const block = rejectCandidateName(candidateName, { sourceType: "yell", sourceUrl });
  if (block.rejected) return block.reason;
  if (isYellCategoryHeading(candidateName)) return "yell_category_heading";
  if (YELL_NEAR_ME_CATEGORY_RE.test(candidateName)) return "near_me_heading";
  return "yell_not_identity_source";
}

function orgWasSetFromYellCandidate(args: {
  displayName: string;
  organisationName: string;
  candidateName: string;
  nameRecoverySource: string | null;
  nameRecoverySourceUrl: string | null;
  sourceUrl: string;
}): boolean {
  const name = args.candidateName.trim();
  if (!name) return false;
  const nameMatches =
    args.displayName.trim() === name || args.organisationName.trim() === name;
  if (!nameMatches) return false;
  if (args.nameRecoverySource?.trim() === "yell") return true;
  const provUrl = args.nameRecoverySourceUrl?.trim();
  if (provUrl && provUrl === args.sourceUrl.trim()) return true;
  return nameMatches;
}

export async function cleanupYellIdentityCandidates(
  prisma: PrismaClient,
  opts: CleanupYellIdentityOptions = {},
): Promise<CleanupYellIdentityResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = Math.max(1, opts.limit ?? 2000);

  const result: CleanupYellIdentityResult = {
    event: "sra_identity_candidates_cleanup_yell",
    dryRun,
    examined: 0,
    rejected: 0,
    orgsReverted: 0,
    reindexQueued: 0,
    samples: [],
  };

  const rows = await prisma.sraIdentityCandidate.findMany({
    where: { sourceType: "yell" },
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
    if (row.status === "rejected") continue;

    const reason = yellIdentityRejectReason(row.candidateName, row.sourceUrl);
    const org = row.organisation;
    const shouldRevert =
      org &&
      orgWasSetFromYellCandidate({
        displayName: org.displayName,
        organisationName: org.organisationName,
        candidateName: row.candidateName,
        nameRecoverySource: org.nameRecoverySource,
        nameRecoverySourceUrl: org.nameRecoverySourceUrl,
        sourceUrl: row.sourceUrl,
      });

    if (result.samples.length < 20) {
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
      data: { status: "rejected", rejectReason: `cleanup_yell:${reason}` },
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
        reason: "sra_identity_cleanup_yell",
      });
      result.reindexQueued++;
    }
  }

  return result;
}
