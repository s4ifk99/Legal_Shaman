import type { PrismaClient } from "@prisma/client";
import { enqueueProviderForIndexing } from "@/lib/ops/enqueue-on-approval";
import { applySraRegisterLookupToRow } from "@/lib/sra/register-name-backfill";
import type { SraRegisterLookupResult } from "@/lib/sra/register-lookup";
import { rejectCandidateName } from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import { kickOffIdentityApprovalCrawls } from "@/lib/sra/missing-identity-recovery/identity-crawl-schedule";
import type { IdentitySourceType, SraIdentityCandidateRecord } from "@/lib/sra/missing-identity-recovery/types";

export type ApproveSraIdentityCandidateOptions = {
  skipCrawl?: boolean;
};

function lookupFromCandidate(c: SraIdentityCandidateRecord): SraRegisterLookupResult {
  const source: SraRegisterLookupResult["source"] =
    c.sourceType === "law_society"
      ? "law_society_sra_lookup"
      : c.sourceType === "local_sra" || c.sourceType === "sra_api"
        ? "sra_api"
        : "sra_register";

  return {
    sraId: c.sraId,
    displayName: c.candidateName,
    organisationName: c.candidateName,
    firmName: c.candidateName,
    address: c.candidateAddress,
    website: c.candidateWebsite,
    phone: c.candidatePhone,
    sourceUrl: c.sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence: c.confidence,
    source,
  };
}

/** Apply approved identity to SRA org, mark candidate, queue index, optionally schedule crawls. */
export async function approveSraIdentityCandidate(
  prisma: PrismaClient,
  candidateId: string,
  options?: ApproveSraIdentityCandidateOptions,
): Promise<
  | { ok: true; entityId: string; crawlScheduled: number; crawlFailed: number }
  | { ok: false; error: string }
> {
  const row = await prisma.sraIdentityCandidate.findUnique({ where: { id: candidateId } });
  if (!row) return { ok: false, error: "not_found" };
  if (!row.candidateName.trim()) return { ok: false, error: "empty_candidate_name" };

  const nameReject = rejectCandidateName(row.candidateName, {
    sourceType: row.sourceType as IdentitySourceType,
    sourceUrl: row.sourceUrl,
  });
  if (nameReject.rejected) return { ok: false, error: `bad_candidate_name:${nameReject.reason}` };

  const record: SraIdentityCandidateRecord = {
    sraId: row.sraId,
    candidateName: row.candidateName,
    sourceType: row.sourceType as IdentitySourceType,
    sourceUrl: row.sourceUrl,
    evidenceText: row.evidenceText,
    candidatePhone: row.candidatePhone || undefined,
    candidateAddress: row.candidateAddress || undefined,
    candidateWebsite: row.candidateWebsite || undefined,
    matchedPostcode: row.matchedPostcode || undefined,
    matchedTown: row.matchedTown || undefined,
    confidence: row.confidence,
    status: "auto_approved",
  };

  const lookup = lookupFromCandidate(record);
  const applied = await applySraRegisterLookupToRow(prisma, row.organisationId, lookup, {
    dryRun: false,
    force: true,
  });
  if (applied === "not_found" || applied === "rejected") {
    return { ok: false, error: applied };
  }

  await prisma.sraOrganisation.update({
    where: { id: row.organisationId },
    data: {
      nameRecoverySource: row.sourceType,
      nameRecoverySourceUrl: row.sourceUrl,
      nameRecoveryConfidence: row.confidence,
      nameRecoveryFetchedAt: new Date(),
    },
  });

  await prisma.sraIdentityCandidate.update({
    where: { id: candidateId },
    data: { status: "auto_approved", rejectReason: "" },
  });

  const entityId = `sra:${row.sraId}`;
  const entityType = "sra_organisation";

  await enqueueProviderForIndexing({
    entityId,
    entityType,
    reason: "sra_identity_approved",
  });

  kickOffIdentityApprovalCrawls(entityId, entityType, {
    skipCrawl: options?.skipCrawl,
  });

  return {
    ok: true,
    entityId,
    crawlScheduled: 0,
    crawlFailed: 0,
  };
}

export async function rejectSraIdentityCandidate(
  prisma: PrismaClient,
  candidateId: string,
  reason?: string,
): Promise<boolean> {
  try {
    await prisma.sraIdentityCandidate.update({
      where: { id: candidateId },
      data: { status: "rejected", rejectReason: reason ?? "admin_rejected" },
    });
    return true;
  } catch {
    return false;
  }
}
