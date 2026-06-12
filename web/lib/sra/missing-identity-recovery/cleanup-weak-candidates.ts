import type { PrismaClient } from "@prisma/client";
import { isWeakIdentityCandidate } from "@/lib/sra/missing-identity-recovery/candidate-evidence";
import type { IdentitySourceType } from "@/lib/sra/missing-identity-recovery/types";

export type CleanupWeakCandidatesOptions = {
  dryRun?: boolean;
  limit?: number;
};

export type CleanupWeakCandidatesResult = {
  event: "sra_identity_candidates_cleanup_weak";
  dryRun: boolean;
  examined: number;
  rejected: number;
  samples: {
    id: string;
    sraId: string;
    candidateName: string;
    reason: string;
    confidence: number;
    extractedSraNumbers: string[];
  }[];
};

export async function cleanupWeakIdentityCandidates(
  prisma: PrismaClient,
  opts: CleanupWeakCandidatesOptions = {},
): Promise<CleanupWeakCandidatesResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = Math.max(1, opts.limit ?? 2000);

  const result: CleanupWeakCandidatesResult = {
    event: "sra_identity_candidates_cleanup_weak",
    dryRun,
    examined: 0,
    rejected: 0,
    samples: [],
  };

  const rows = await prisma.sraIdentityCandidate.findMany({
    where: { status: "pending_review", candidateName: { not: "" } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      organisation: {
        select: {
          postcode: true,
          city: true,
          website: true,
        },
      },
    },
  });

  result.examined = rows.length;

  for (const row of rows) {
    const weak = isWeakIdentityCandidate({
      sraId: row.sraId,
      candidateName: row.candidateName,
      sourceType: row.sourceType as IdentitySourceType,
      sourceUrl: row.sourceUrl,
      evidenceText: row.evidenceText,
      candidateAddress: row.candidateAddress,
      candidateWebsite: row.candidateWebsite,
      matchedPostcode: row.matchedPostcode,
      matchedTown: row.matchedTown,
      orgPostcode: row.organisation.postcode,
      orgCity: row.organisation.city,
      orgWebsite: row.organisation.website,
    });

    if (!weak.weak || !weak.reason) continue;

    if (result.samples.length < 20) {
      result.samples.push({
        id: row.id,
        sraId: row.sraId,
        candidateName: row.candidateName,
        reason: weak.reason,
        confidence: weak.evaluation.confidence,
        extractedSraNumbers: weak.evaluation.extractedSraNumbers,
      });
    }

    if (dryRun) {
      result.rejected++;
      continue;
    }

    await prisma.sraIdentityCandidate.update({
      where: { id: row.id },
      data: { status: "rejected", rejectReason: `cleanup_weak:${weak.reason}` },
    });
    result.rejected++;
  }

  return result;
}
