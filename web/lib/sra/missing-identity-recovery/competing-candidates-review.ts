import type { PrismaClient } from "@prisma/client";
import { isAddressLikeCandidateName } from "@/lib/sra/missing-identity-recovery/candidate-validator";
import {
  evaluateCandidateEvidence,
  isViableIdentityCandidate,
  type CandidateDomainType,
  type CandidateEvidenceEvaluation,
  type CandidateScoreBreakdown,
} from "@/lib/sra/missing-identity-recovery/candidate-evidence";
import { isIdentityCandidatesTableMissing } from "@/lib/sra/missing-identity-recovery/candidate-promotion";
import { rejectCandidateName } from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import { withDbRetry } from "@/lib/sra/missing-identity-recovery/load-organisation-batch";
import type { IdentitySourceType } from "@/lib/sra/missing-identity-recovery/types";

export type CompetingCandidateReviewAction =
  | "manual_review"
  | "auto_pick_exact_sra_number"
  | "reject_bad_candidates";

export type CompetingCandidateSummary = {
  id: string;
  candidateName: string;
  sourceType: string;
  confidence: number;
  sourceUrl: string;
  evidenceText: string;
  status: string;
  extractedSraNumbers: string[];
  sraNumberMatch: boolean;
  postcodeMatch: boolean;
  domainType: CandidateDomainType;
  scoreBreakdown: CandidateScoreBreakdown;
};

export type CompetingCandidateGroup = {
  sraId: string;
  currentDisplayName: string;
  postcode: string;
  city: string;
  candidates: CompetingCandidateSummary[];
  recommendedAction: CompetingCandidateReviewAction;
};

export type CompetingCandidatesReviewResult = {
  event: "sra_identity_candidates_competing";
  limit: number;
  examined: number;
  groupCount: number;
  groups: CompetingCandidateGroup[];
  tableMissing?: boolean;
  migrationHint?: string;
};

export type CompetingCandidateInput = {
  id: string;
  candidateName: string;
  sourceType: IdentitySourceType;
  sourceUrl: string;
  evidenceText: string;
  candidateAddress: string;
  matchedPostcode: string;
  confidence: number;
  status: string;
  candidateWebsite?: string;
};

export type CompetingOrgContext = {
  sraId: string;
  postcode: string;
  city: string;
};

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

/** True when the same SRA id has two or more distinct pending firm names. */
export function hasCompetingCandidateNames(
  candidates: { candidateName: string }[],
): boolean {
  const names = new Set<string>();
  for (const c of candidates) {
    const n = normaliseName(c.candidateName);
    if (n) names.add(n);
  }
  return names.size >= 2;
}

export function evaluateCompetingCandidate(
  candidate: CompetingCandidateInput,
  org: CompetingOrgContext,
): CandidateEvidenceEvaluation {
  return evaluateCandidateEvidence({
    sraId: org.sraId,
    candidateName: candidate.candidateName,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    evidenceText: candidate.evidenceText,
    candidateAddress: candidate.candidateAddress,
    candidateWebsite: candidate.candidateWebsite,
    matchedPostcode: candidate.matchedPostcode,
    orgPostcode: org.postcode,
    orgCity: org.city,
  });
}

export function isRejectedCompetingCandidate(
  candidate: Pick<CompetingCandidateInput, "candidateName" | "sourceType" | "sourceUrl">,
  evaluation?: CandidateEvidenceEvaluation,
): boolean {
  if (!candidate.candidateName.trim()) return true;
  if (isAddressLikeCandidateName(candidate.candidateName)) return true;
  if (evaluation && !isViableIdentityCandidate(evaluation)) return true;
  if (evaluation?.rejected) return true;
  return rejectCandidateName(candidate.candidateName, {
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
  }).rejected;
}

/** Competing names among viable pending candidates only. */
export function hasCompetingViableCandidates(
  candidates: CompetingCandidateInput[],
  org: CompetingOrgContext,
): boolean {
  const viable = candidates.filter((c) => {
    const evaluation = evaluateCompetingCandidate(c, org);
    return isViableIdentityCandidate(evaluation);
  });
  return hasCompetingCandidateNames(viable);
}

export function recommendCompetingCandidateAction(
  candidates: CompetingCandidateInput[],
  org: CompetingOrgContext,
): CompetingCandidateReviewAction {
  const evaluated = candidates.map((c) => ({
    candidate: c,
    evaluation: evaluateCompetingCandidate(c, org),
  }));

  const viable = evaluated.filter(
    ({ candidate, evaluation }) => !isRejectedCompetingCandidate(candidate, evaluation),
  );
  if (viable.length === 0) return "reject_bad_candidates";

  const withExactSra = viable.filter(({ evaluation }) => evaluation.sraNumberMatch);
  if (withExactSra.length === 1) return "auto_pick_exact_sra_number";

  return "manual_review";
}

function toSummary(
  row: CompetingCandidateInput,
  evaluation: CandidateEvidenceEvaluation,
): CompetingCandidateSummary {
  return {
    id: row.id,
    candidateName: row.candidateName,
    sourceType: row.sourceType,
    confidence: evaluation.confidence,
    sourceUrl: row.sourceUrl,
    evidenceText: row.evidenceText,
    status: row.status,
    extractedSraNumbers: evaluation.extractedSraNumbers,
    sraNumberMatch: evaluation.sraNumberMatch,
    postcodeMatch: evaluation.postcodeMatch,
    domainType: evaluation.domainType,
    scoreBreakdown: evaluation.scoreBreakdown,
  };
}

type LoadedRow = CompetingCandidateInput & {
  sraId: string;
  organisation: {
    displayName: string;
    postcode: string;
    city: string;
  };
};

function buildGroup(sraId: string, rows: LoadedRow[]): CompetingCandidateGroup {
  const org = rows[0]!.organisation;
  const orgCtx = { sraId, postcode: org.postcode, city: org.city };
  const candidates = rows.map((r) => ({
    id: r.id,
    candidateName: r.candidateName,
    sourceType: r.sourceType,
    sourceUrl: r.sourceUrl,
    evidenceText: r.evidenceText,
    candidateAddress: r.candidateAddress,
    matchedPostcode: r.matchedPostcode,
    confidence: r.confidence,
    status: r.status,
    candidateWebsite: r.candidateWebsite,
  }));

  const evaluated = candidates.map((c) => ({
    candidate: c,
    evaluation: evaluateCompetingCandidate(c, orgCtx),
  }));

  return {
    sraId,
    currentDisplayName: org.displayName,
    postcode: org.postcode,
    city: org.city,
    candidates: evaluated.map(({ candidate, evaluation }) => toSummary(candidate, evaluation)),
    recommendedAction: recommendCompetingCandidateAction(candidates, orgCtx),
  };
}

export async function reviewCompetingIdentityCandidates(
  prisma: PrismaClient,
  opts: { limit?: number } = {},
): Promise<CompetingCandidatesReviewResult> {
  const limit = Math.max(1, opts.limit ?? 50);

  const result: CompetingCandidatesReviewResult = {
    event: "sra_identity_candidates_competing",
    limit,
    examined: 0,
    groupCount: 0,
    groups: [],
  };

  let rows: LoadedRow[];
  try {
    const raw = await withDbRetry("sraIdentityCandidate.findMany.competing", () =>
      prisma.sraIdentityCandidate.findMany({
        where: {
          status: "pending_review",
          candidateName: { not: "" },
        },
        orderBy: [{ sraId: "asc" }, { confidence: "desc" }],
        select: {
          id: true,
          sraId: true,
          candidateName: true,
          sourceType: true,
          sourceUrl: true,
          evidenceText: true,
          candidateAddress: true,
          candidateWebsite: true,
          matchedPostcode: true,
          confidence: true,
          status: true,
          organisation: {
            select: {
              displayName: true,
              postcode: true,
              city: true,
            },
          },
        },
      }),
    );
    rows = raw.map((row) => ({
      ...row,
      sourceType: row.sourceType as IdentitySourceType,
    }));
  } catch (err) {
    if (isIdentityCandidatesTableMissing(err)) {
      result.tableMissing = true;
      result.migrationHint = "npm run db:migrate";
      return result;
    }
    throw err;
  }

  result.examined = rows.length;

  const bySra = new Map<string, LoadedRow[]>();
  for (const row of rows) {
    const list = bySra.get(row.sraId) ?? [];
    list.push({
      id: row.id,
      sraId: row.sraId,
      candidateName: row.candidateName,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      evidenceText: row.evidenceText,
      candidateAddress: row.candidateAddress,
      candidateWebsite: row.candidateWebsite,
      matchedPostcode: row.matchedPostcode,
      confidence: row.confidence,
      status: row.status,
      organisation: row.organisation,
    });
    bySra.set(row.sraId, list);
  }

  const groups: CompetingCandidateGroup[] = [];
  for (const [sraId, sraRows] of bySra) {
    const orgCtx = {
      sraId,
      postcode: sraRows[0]!.organisation.postcode,
      city: sraRows[0]!.organisation.city,
    };
    if (!hasCompetingViableCandidates(sraRows, orgCtx)) continue;
    groups.push(buildGroup(sraId, sraRows));
  }

  groups.sort((a, b) => {
    const aTop = a.candidates[0]?.confidence ?? 0;
    const bTop = b.candidates[0]?.confidence ?? 0;
    if (bTop !== aTop) return bTop - aTop;
    return b.candidates.length - a.candidates.length;
  });

  result.groups = groups.slice(0, limit);
  result.groupCount = result.groups.length;
  return result;
}
