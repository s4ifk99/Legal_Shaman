import {
  canSerperAutoApprove,
  rejectCandidateName,
} from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import { evaluateCandidateEvidence } from "@/lib/sra/missing-identity-recovery/candidate-evidence";
import type { SraIdentityCandidateRecord } from "@/lib/sra/missing-identity-recovery/types";

const LEGAL_RE =
  /\b(solicitor|solicitors|law firm|lawyers?|barrister|legal services|chambers|attorney)\b/i;

export function pageTextLooksLegal(text: string): boolean {
  return LEGAL_RE.test(text);
}

export function scoreIdentityCandidate(args: {
  candidate: Omit<SraIdentityCandidateRecord, "confidence" | "status">;
  sraId: string;
  postcode: string;
  town: string;
  pageText?: string;
  sraIdInEvidence?: boolean;
}): number {
  const { candidate, sraId, postcode, town } = args;
  const evidenceText = `${candidate.evidenceText} ${args.pageText ?? ""}`.trim();

  const evaluation = evaluateCandidateEvidence({
    sraId,
    candidateName: candidate.candidateName,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    evidenceText,
    candidateAddress: candidate.candidateAddress,
    candidateWebsite: candidate.candidateWebsite,
    matchedPostcode: candidate.matchedPostcode,
    matchedTown: candidate.matchedTown ?? town,
    orgPostcode: postcode,
    orgCity: town,
  });

  if (evaluation.rejected) return 0;

  if (args.sraIdInEvidence && !evaluation.sraNumberMatch) {
    return Math.max(evaluation.confidence, 0.95);
  }

  return evaluation.confidence;
}

export function normalisePc(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

export function shouldAutoApprove(
  candidate: SraIdentityCandidateRecord,
  competingCount: number,
  opts?: { orgPostcode?: string; competingMaxConfidence?: number },
): boolean {
  if (rejectCandidateName(candidate.candidateName, {
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
  }).rejected) {
    return false;
  }
  if (!pageTextLooksLegal(candidate.evidenceText)) return false;

  const evaluation = evaluateCandidateEvidence({
    sraId: candidate.sraId,
    candidateName: candidate.candidateName,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    evidenceText: candidate.evidenceText,
    candidateAddress: candidate.candidateAddress,
    candidateWebsite: candidate.candidateWebsite,
    matchedPostcode: candidate.matchedPostcode,
    matchedTown: candidate.matchedTown,
    orgPostcode: opts?.orgPostcode ?? candidate.matchedPostcode ?? "",
  });

  if (evaluation.rejected) return false;
  if (evaluation.sraNumberMatch) return true;

  if (candidate.sourceType === "sra_api") {
    return candidate.confidence >= 0.95;
  }

  if (candidate.sourceType === "law_society") {
    return Boolean(candidate.matchedPostcode) && candidate.confidence >= 0.95;
  }

  if (candidate.sourceType === "yell") return false;

  if (candidate.sourceType === "serper" || candidate.sourceType === "google") {
    if (competingCount > 0 && (opts?.competingMaxConfidence ?? 0) > 0.8) {
      return false;
    }
    return canSerperAutoApprove({
      sraId: candidate.sraId,
      candidateName: candidate.candidateName,
      sourceUrl: candidate.sourceUrl,
      evidenceText: candidate.evidenceText,
      candidateWebsite: candidate.candidateWebsite,
      matchedPostcode: candidate.matchedPostcode,
      orgPostcode: opts?.orgPostcode ?? candidate.matchedPostcode ?? "",
      competingMaxConfidence: opts?.competingMaxConfidence,
    });
  }

  if (!candidate.matchedPostcode) return false;
  return candidate.confidence >= 0.9;
}
