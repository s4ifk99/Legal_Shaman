import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { approveSraIdentityCandidate } from "@/lib/sra/missing-identity-recovery/approve-candidate";
import {
  evaluateCandidateEvidence,
  isViableIdentityCandidate,
} from "@/lib/sra/missing-identity-recovery/candidate-evidence";
import { isAddressLikeCandidateName } from "@/lib/sra/missing-identity-recovery/candidate-validator";
import { rejectCandidateName } from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import { withDbRetry } from "@/lib/sra/missing-identity-recovery/load-organisation-batch";
import type { IdentitySourceType } from "@/lib/sra/missing-identity-recovery/types";
import {
  classifySraStoredName,
  isPlaceholderSraDisplayName,
} from "@/lib/sra/sra-name-quality";

export const SAFE_APPROVE_MIN_CONFIDENCE = 0.9;

export function isIdentityCandidatesTableMissing(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2021" &&
    String(err.meta?.modelName ?? "").includes("SraIdentityCandidate")
  );
}

export function emptyIdentityCandidateStats(): SraIdentityCandidateStats {
  return {
    event: "sra_identity_candidates_stats",
    byStatus: {},
    bySourceType: {},
    pendingReview: 0,
    autoApproved: 0,
    samplePending: [],
    sampleApproved: [],
    tableMissing: true,
    migrationHint: "npm run db:migrate",
  };
}
export const SAFE_APPROVE_SOURCE_TYPES: IdentitySourceType[] = ["serper", "sra_api"];

export type CandidateRowForPromotion = {
  id: string;
  sraId: string;
  candidateName: string;
  sourceType: string;
  sourceUrl: string;
  evidenceText: string;
  candidateAddress: string;
  matchedPostcode: string;
  confidence: number;
  status: string;
  orgPostcode?: string;
  orgCity?: string;
  orgWebsite?: string;
};

export type CandidatePeerRow = {
  id: string;
  candidateName: string;
  sourceType: string;
  sourceUrl: string;
  evidenceText: string;
  candidateAddress: string;
  matchedPostcode: string;
  sraId: string;
  orgPostcode: string;
  orgCity: string;
  orgWebsite: string;
};

export type SraIdentityCandidateStats = {
  event: "sra_identity_candidates_stats";
  byStatus: Record<string, number>;
  bySourceType: Record<string, number>;
  pendingReview: number;
  autoApproved: number;
  samplePending: CandidateSample[];
  sampleApproved: CandidateSample[];
  tableMissing?: boolean;
  migrationHint?: string;
};

export type CandidateSample = {
  id: string;
  sraId: string;
  candidateName: string;
  sourceType: string;
  confidence: number;
  status: string;
};

export type ApproveSkipReason =
  | "not_pending_review"
  | "low_confidence"
  | "unsupported_source"
  | "address_like_name"
  | "bad_candidate_name"
  | "competing_candidate"
  | "empty_name"
  | "approve_failed";

export type BatchApproveIdentityCandidatesOptions = {
  limit?: number;
  dryRun?: boolean;
  minConfidence?: number;
  skipCrawl?: boolean;
};

export type BatchApproveIdentityCandidatesResult = {
  event: "sra_identity_candidates_approve";
  dryRun: boolean;
  examined: number;
  eligible: number;
  approved: number;
  skipped: Record<ApproveSkipReason, number>;
  errors: { id: string; sraId: string; error: string }[];
  samples: { id: string; sraId: string; candidateName: string; sourceType: string; confidence: number }[];
};

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

/** Distinct competing firm names for the same SRA id (excluding the chosen name). */
export function countCompetingCandidateNames(
  peers: { candidateName: string }[],
  chosenName: string,
): number {
  const chosen = normaliseName(chosenName);
  const names = new Set<string>();
  for (const p of peers) {
    const n = normaliseName(p.candidateName);
    if (!n || n === chosen) continue;
    names.add(n);
  }
  return names.size;
}

/** Distinct viable competing firm names for the same SRA id. */
export function countCompetingViableCandidates(
  peers: CandidatePeerRow[],
  chosenName: string,
): number {
  const chosen = normaliseName(chosenName);
  const names = new Set<string>();
  for (const p of peers) {
    const n = normaliseName(p.candidateName);
    if (!n || n === chosen) continue;
    const evaluation = evaluateCandidateEvidence({
      sraId: p.sraId,
      candidateName: p.candidateName,
      sourceType: p.sourceType as IdentitySourceType,
      sourceUrl: p.sourceUrl,
      evidenceText: p.evidenceText,
      candidateAddress: p.candidateAddress,
      matchedPostcode: p.matchedPostcode,
      orgPostcode: p.orgPostcode,
      orgCity: p.orgCity,
      orgWebsite: p.orgWebsite,
    });
    if (!isViableIdentityCandidate(evaluation)) continue;
    names.add(n);
  }
  return names.size;
}

export function isEligibleForBatchApprove(
  row: CandidateRowForPromotion,
  competingNameCount: number,
  opts?: { minConfidence?: number; sourceTypes?: IdentitySourceType[] },
): { ok: true } | { ok: false; reason: ApproveSkipReason } {
  const minConfidence = opts?.minConfidence ?? SAFE_APPROVE_MIN_CONFIDENCE;
  const sourceTypes = opts?.sourceTypes ?? SAFE_APPROVE_SOURCE_TYPES;

  if (row.status !== "pending_review") return { ok: false, reason: "not_pending_review" };
  if (!row.candidateName.trim()) return { ok: false, reason: "empty_name" };
  if (row.confidence < minConfidence) return { ok: false, reason: "low_confidence" };
  if (!sourceTypes.includes(row.sourceType as IdentitySourceType)) {
    return { ok: false, reason: "unsupported_source" };
  }
  if (
    isAddressLikeCandidateName(row.candidateName) ||
    classifySraStoredName(row.candidateName, row.sraId) === "address_like_name"
  ) {
    return { ok: false, reason: "address_like_name" };
  }
  if (
    rejectCandidateName(row.candidateName, {
      sourceType: row.sourceType as IdentitySourceType,
      sourceUrl: row.sourceUrl,
    }).rejected
  ) {
    return { ok: false, reason: "bad_candidate_name" };
  }

  const evaluation = evaluateCandidateEvidence({
    sraId: row.sraId,
    candidateName: row.candidateName,
    sourceType: row.sourceType as IdentitySourceType,
    sourceUrl: row.sourceUrl,
    evidenceText: row.evidenceText,
    candidateAddress: row.candidateAddress,
    matchedPostcode: row.matchedPostcode,
    orgPostcode: row.orgPostcode,
    orgCity: row.orgCity,
    orgWebsite: row.orgWebsite,
  });
  if (evaluation.rejected) return { ok: false, reason: "bad_candidate_name" };
  if (!isViableIdentityCandidate(evaluation)) {
    return { ok: false, reason: "low_confidence" };
  }
  if (evaluation.confidence < minConfidence) return { ok: false, reason: "low_confidence" };

  if (row.sourceType === "serper" || row.sourceType === "google") {
    if (!evaluation.sraNumberMatch && evaluation.confidence < 0.9) {
      return { ok: false, reason: "low_confidence" };
    }
  }

  if (competingNameCount > 0) return { ok: false, reason: "competing_candidate" };
  return { ok: true };
}

export async function getSraIdentityCandidateStats(
  prisma: PrismaClient,
): Promise<SraIdentityCandidateStats> {
  try {
    return await loadSraIdentityCandidateStats(prisma);
  } catch (err) {
    if (isIdentityCandidatesTableMissing(err)) return emptyIdentityCandidateStats();
    throw err;
  }
}

async function loadSraIdentityCandidateStats(
  prisma: PrismaClient,
): Promise<SraIdentityCandidateStats> {
  const [byStatus, bySource, pendingSamples, approvedSamples] = await Promise.all([
    prisma.sraIdentityCandidate.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.sraIdentityCandidate.groupBy({
      by: ["sourceType"],
      _count: { _all: true },
    }),
    prisma.sraIdentityCandidate.findMany({
      where: { status: "pending_review", candidateName: { not: "" } },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        sraId: true,
        candidateName: true,
        sourceType: true,
        confidence: true,
        status: true,
      },
    }),
    prisma.sraIdentityCandidate.findMany({
      where: { status: "auto_approved", candidateName: { not: "" } },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        sraId: true,
        candidateName: true,
        sourceType: true,
        confidence: true,
        status: true,
      },
    }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const g of byStatus) statusMap[g.status] = g._count._all;

  const sourceMap: Record<string, number> = {};
  for (const g of bySource) sourceMap[g.sourceType] = g._count._all;

  return {
    event: "sra_identity_candidates_stats",
    byStatus: statusMap,
    bySourceType: sourceMap,
    pendingReview: statusMap.pending_review ?? 0,
    autoApproved: statusMap.auto_approved ?? 0,
    samplePending: pendingSamples,
    sampleApproved: approvedSamples,
  };
}

async function loadPendingPeersBySraId(
  prisma: PrismaClient,
  sraIds: string[],
): Promise<Map<string, CandidatePeerRow[]>> {
  if (sraIds.length === 0) return new Map();

  const peers = await prisma.sraIdentityCandidate.findMany({
    where: {
      sraId: { in: sraIds },
      status: "pending_review",
      candidateName: { not: "" },
    },
    select: {
      id: true,
      sraId: true,
      candidateName: true,
      sourceType: true,
      sourceUrl: true,
      evidenceText: true,
      candidateAddress: true,
      matchedPostcode: true,
      organisation: {
        select: { postcode: true, city: true, website: true },
      },
    },
  });

  const map = new Map<string, CandidatePeerRow[]>();
  for (const p of peers) {
    const list = map.get(p.sraId) ?? [];
    list.push({
      id: p.id,
      sraId: p.sraId,
      candidateName: p.candidateName,
      sourceType: p.sourceType,
      sourceUrl: p.sourceUrl,
      evidenceText: p.evidenceText,
      candidateAddress: p.candidateAddress,
      matchedPostcode: p.matchedPostcode,
      orgPostcode: p.organisation.postcode,
      orgCity: p.organisation.city,
      orgWebsite: p.organisation.website,
    });
    map.set(p.sraId, list);
  }
  return map;
}

export async function approvePendingIdentityCandidates(
  prisma: PrismaClient,
  opts: BatchApproveIdentityCandidatesOptions = {},
): Promise<BatchApproveIdentityCandidatesResult> {
  const limit = Math.max(1, opts.limit ?? 25);
  const dryRun = opts.dryRun ?? false;
  const minConfidence = opts.minConfidence ?? SAFE_APPROVE_MIN_CONFIDENCE;

  const skipped: Record<ApproveSkipReason, number> = {
    not_pending_review: 0,
    low_confidence: 0,
    unsupported_source: 0,
    address_like_name: 0,
    bad_candidate_name: 0,
    competing_candidate: 0,
    empty_name: 0,
    approve_failed: 0,
  };

  const result: BatchApproveIdentityCandidatesResult = {
    event: "sra_identity_candidates_approve",
    dryRun,
    examined: 0,
    eligible: 0,
    approved: 0,
    skipped,
    errors: [],
    samples: [],
  };

  let pool: CandidateRowForPromotion[];
  try {
    const raw = await withDbRetry("sraIdentityCandidate.findMany", () =>
      prisma.sraIdentityCandidate.findMany({
        where: {
          status: "pending_review",
          candidateName: { not: "" },
          sourceType: { in: [...SAFE_APPROVE_SOURCE_TYPES] },
        },
        orderBy: [{ confidence: "desc" }, { updatedAt: "asc" }],
        take: Math.min(limit * 8, 500),
        select: {
          id: true,
          sraId: true,
          candidateName: true,
          sourceType: true,
          sourceUrl: true,
          evidenceText: true,
          candidateAddress: true,
          matchedPostcode: true,
          confidence: true,
          status: true,
          organisation: {
            select: { postcode: true, city: true, website: true },
          },
        },
      }),
    );
    pool = raw.map((row) => ({
      id: row.id,
      sraId: row.sraId,
      candidateName: row.candidateName,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      evidenceText: row.evidenceText,
      candidateAddress: row.candidateAddress,
      matchedPostcode: row.matchedPostcode,
      confidence: row.confidence,
      status: row.status,
      orgPostcode: row.organisation.postcode,
      orgCity: row.organisation.city,
      orgWebsite: row.organisation.website,
    }));
  } catch (err) {
    if (isIdentityCandidatesTableMissing(err)) {
      result.errors.push({
        id: "",
        sraId: "",
        error: "sra_identity_candidates table missing — run npm run db:migrate",
      });
      return result;
    }
    throw err;
  }

  result.examined = pool.length;
  const peersBySra = await loadPendingPeersBySraId(prisma, [...new Set(pool.map((r) => r.sraId))]);
  const approvedSraIds = new Set<string>();

  for (const row of pool) {
    if (result.approved >= limit) break;
    if (approvedSraIds.has(row.sraId)) {
      skipped.competing_candidate++;
      continue;
    }

    const peers = peersBySra.get(row.sraId) ?? [];
    const competing = countCompetingViableCandidates(peers, row.candidateName);
    const gate = isEligibleForBatchApprove(row, competing, { minConfidence });
    if (!gate.ok) {
      skipped[gate.reason]++;
      continue;
    }

    result.eligible++;
    if (result.samples.length < 10) {
      result.samples.push({
        id: row.id,
        sraId: row.sraId,
        candidateName: row.candidateName,
        sourceType: row.sourceType,
        confidence: row.confidence,
      });
    }

    if (dryRun) {
      result.approved++;
      approvedSraIds.add(row.sraId);
      continue;
    }

    const applied = await approveSraIdentityCandidate(prisma, row.id, {
      skipCrawl: opts.skipCrawl,
    });
    if (!applied.ok) {
      skipped.approve_failed++;
      if (result.errors.length < 12) {
        result.errors.push({ id: row.id, sraId: row.sraId, error: applied.error });
      }
      continue;
    }

    result.approved++;
    approvedSraIds.add(row.sraId);
  }

  return result;
}

/** Orgs promoted via identity approval should count as recovered in coverage reports. */
export function organisationHasRecoveredName(args: {
  displayName: string;
  sraId: string;
  nameRecoverySource: string | null | undefined;
  nameRecoveryConfidence: number | null | undefined;
  hasApprovedCandidate: boolean;
}): boolean {
  const displayIsPlaceholder = isPlaceholderSraDisplayName(args.displayName, args.sraId);
  const cls = classifySraStoredName(args.displayName, args.sraId);
  if (displayIsPlaceholder || cls === "placeholder") return false;

  return (
    Boolean(args.nameRecoverySource?.trim()) ||
    args.hasApprovedCandidate
  );
}
