import {
  isOfficialFirmWebsiteUrl,
  isUnacceptableSerperEvidenceUrl,
  rejectCandidateName,
  serperEvidenceHasExactPostcode,
} from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import { pageTextLooksLegal } from "@/lib/sra/missing-identity-recovery/confidence";
import { scoreOfficialDomain } from "@/lib/provider-osint/official-domain-scoring";
import {
  evidenceBlob,
  evidenceHasExactSraNumber,
  extractSraNumbersFromText,
} from "@/lib/sra/missing-identity-recovery/sra-number-evidence";
import type { IdentitySourceType } from "@/lib/sra/missing-identity-recovery/types";

export type CandidateDomainType =
  | "official_firm"
  | "directory"
  | "review"
  | "regulator"
  | "junk";

export type CandidateScoreBreakdown = {
  base: number;
  reason?: string;
  sraNumberMatch?: boolean;
  postcodeMatch?: boolean;
  firmNameEvidence?: boolean;
  legalCategory?: boolean;
  officialWebsite?: boolean;
  domainNameSimilarity?: boolean;
  knownOrgWebsite?: boolean;
  officialFirmPageTitle?: boolean;
  strongIdentitySignal?: boolean;
  directoryCap?: number;
  cappedAt?: number;
  rejection?: string;
};

export type CandidateEvidenceInput = {
  sraId: string;
  candidateName: string;
  sourceType: IdentitySourceType;
  sourceUrl: string;
  evidenceText: string;
  candidateAddress?: string;
  candidateWebsite?: string;
  matchedPostcode?: string;
  matchedTown?: string;
  orgPostcode?: string;
  orgCity?: string;
  orgWebsite?: string;
};

export type CandidateEvidenceEvaluation = {
  extractedSraNumbers: string[];
  sraNumberMatch: boolean;
  sraNumberMismatch: boolean;
  postcodeMatch: boolean;
  domainType: CandidateDomainType;
  scoreBreakdown: CandidateScoreBreakdown;
  confidence: number;
  rejected: boolean;
  rejectReason?: string;
};

const MIN_REVIEW_CONFIDENCE = 0.75;

const REVIEW_HOST_RE =
  /\b(solicitors\.guru|solicitortree|thegoodsolicitorguide|lawboard\.co\.uk|trustpilot|lawyers\.com|wheree\.com|legalnews\.com|findlaw|thelawpages|hotfrog|cylex|192\.com|stowe\.co\.uk)\b/i;

const JUNK_HOST_RE =
  /\b(no[- ]?win[- ]?no[- ]?fee|claims?|compensation|injury|medical[- ]?negligence|lead[- ]?gen|referral)\b/i;

const BAD_SOURCE_HOST_RE =
  /\b(legalnews\.com|lawyers\.com|wheree\.com|solicitors\.guru|thegoodsolicitorguide\.com|lawboard\.co\.uk)\b/i;

const DIRECTORY_PATH_RE =
  /\b(reviews?|directory|listings?|top[- ]solicitors?|find-a-solicitor|office\/\d+)\b/i;

const STRONG_FIRM_NAME_RE =
  /\b(solicitors?\s+(LLP|Ltd|Limited|PLC)|\b(LLP|Ltd|Limited|PLC)\b|(?:\S+\s+){1,6}solicitors?\b)/i;

const LEGAL_CATEGORY_RE =
  /\b(family|employment|immigration|housing|criminal|conveyancing|probate|personal injury|commercial)\s+(law|solicitors?|lawyers?)\b/i;

function parseHostname(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function parsePathname(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function normaliseHost(url: string): string {
  return parseHostname(url).replace(/^www\./, "");
}

export function classifyCandidateDomainType(
  sourceUrl: string,
  candidateName: string,
): CandidateDomainType {
  const host = parseHostname(sourceUrl);
  const path = parsePathname(sourceUrl);
  const blob = `${host}${path} ${candidateName}`;

  if (/\b(sra\.org\.uk|lawsociety\.org\.uk|legalservices\.gov\.uk)\b/.test(host)) {
    return "regulator";
  }
  if (JUNK_HOST_RE.test(blob)) return "junk";
  if (REVIEW_HOST_RE.test(blob) || /\breviews?\s+of\b/i.test(candidateName)) {
    return "review";
  }
  if (
    BAD_SOURCE_HOST_RE.test(host) ||
    /\b(yell\.com|yelp\.|facebook\.com|linkedin\.com|google\.|bing\.com)\b/.test(host) ||
    DIRECTORY_PATH_RE.test(path) ||
    DIRECTORY_PATH_RE.test(candidateName)
  ) {
    return "directory";
  }
  if (isOfficialFirmWebsiteUrl(sourceUrl)) return "official_firm";
  if (isUnacceptableSerperEvidenceUrl(sourceUrl)) return "junk";
  return "directory";
}

export function isBadCandidateSourceDomain(
  sourceUrl: string,
  targetSraId: string,
  evidenceText: string,
  candidateName?: string,
): boolean {
  const host = parseHostname(sourceUrl);
  if (!host) return true;
  if (BAD_SOURCE_HOST_RE.test(host) || REVIEW_HOST_RE.test(host) || JUNK_HOST_RE.test(host)) {
    return !evidenceHasExactSraNumber(targetSraId, evidenceText, candidateName);
  }
  if (isUnacceptableSerperEvidenceUrl(sourceUrl)) {
    return !evidenceHasExactSraNumber(targetSraId, evidenceText, candidateName);
  }
  return false;
}

/** LLP/Ltd/PLC-style firm name — used for scoring caps, not postcode-only promotion. */
export function hasStrongFirmNameEvidence(name: string): boolean {
  return STRONG_FIRM_NAME_RE.test(name.trim());
}

function hasLegalCategoryEvidence(blob: string): boolean {
  return LEGAL_CATEGORY_RE.test(blob) || /\b(law firm|legal services|chambers)\b/i.test(blob);
}

export function hasDomainNameSimilarity(candidateName: string, sourceUrl: string): boolean {
  const domain = scoreOfficialDomain(sourceUrl, candidateName);
  return !domain.isDirectory && domain.nameOverlap >= 0.45;
}

export function hasKnownOrgWebsite(sourceUrl: string, orgWebsite?: string): boolean {
  const orgHost = normaliseHost(orgWebsite ?? "");
  const sourceHost = normaliseHost(sourceUrl);
  return Boolean(orgHost && sourceHost && orgHost === sourceHost);
}

export function isOfficialFirmPageTitle(
  name: string,
  opts?: { sourceType?: IdentitySourceType; sourceUrl?: string },
): boolean {
  if (rejectCandidateName(name, opts).rejected) return false;
  return hasStrongFirmNameEvidence(name);
}

export function isViableIdentityCandidate(evaluation: CandidateEvidenceEvaluation): boolean {
  return !evaluation.rejected && evaluation.confidence > 0;
}

function rejectedEvaluation(
  partial: Omit<CandidateEvidenceEvaluation, "rejected" | "confidence"> & {
    rejectReason: string;
  },
): CandidateEvidenceEvaluation {
  return {
    ...partial,
    confidence: 0,
    rejected: true,
    rejectReason: partial.rejectReason,
    scoreBreakdown: {
      ...partial.scoreBreakdown,
      rejection: partial.rejectReason,
    },
  };
}

export function evaluateCandidateEvidence(
  input: CandidateEvidenceInput,
): CandidateEvidenceEvaluation {
  const blob = evidenceBlob(
    input.evidenceText,
    input.candidateAddress,
    input.candidateName,
  );
  const extractedSraNumbers = extractSraNumbersFromText(blob);
  const sraNumberMatch = evidenceHasExactSraNumber(
    input.sraId,
    input.evidenceText,
    input.candidateAddress,
    input.candidateName,
  );
  const orgPostcode = input.orgPostcode ?? input.matchedPostcode ?? "";
  const postcodeMatch = serperEvidenceHasExactPostcode(
    orgPostcode,
    input.matchedPostcode,
    blob,
  );
  const domainType = classifyCandidateDomainType(input.sourceUrl, input.candidateName);
  const breakdown: CandidateScoreBreakdown = { base: 0 };

  const baseFields = {
    extractedSraNumbers,
    postcodeMatch,
    domainType,
  };

  const nameReject = rejectCandidateName(input.candidateName, {
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
  });
  if (nameReject.rejected) {
    return rejectedEvaluation({
      ...baseFields,
      sraNumberMatch,
      sraNumberMismatch: false,
      scoreBreakdown: { ...breakdown, rejection: nameReject.reason },
      rejectReason: nameReject.reason,
    });
  }

  if (
    isBadCandidateSourceDomain(
      input.sourceUrl,
      input.sraId,
      input.evidenceText,
      input.candidateName,
    )
  ) {
    return rejectedEvaluation({
      ...baseFields,
      sraNumberMatch,
      sraNumberMismatch: false,
      scoreBreakdown: { ...breakdown, rejection: "bad_source_domain" },
      rejectReason: "bad_source_domain",
    });
  }

  if (extractedSraNumbers.length > 0 && !sraNumberMatch) {
    return rejectedEvaluation({
      ...baseFields,
      sraNumberMatch: false,
      sraNumberMismatch: true,
      scoreBreakdown: { ...breakdown, rejection: "sra_number_mismatch", sraNumberMatch: false },
      rejectReason: "sra_number_mismatch",
    });
  }

  if (sraNumberMatch) {
    return {
      ...baseFields,
      sraNumberMatch: true,
      sraNumberMismatch: false,
      scoreBreakdown: {
        base: 0.99,
        reason: "exact_sra_number_match",
        sraNumberMatch: true,
        postcodeMatch,
      },
      confidence: 0.99,
      rejected: false,
    };
  }

  const officialWebsite =
    isOfficialFirmWebsiteUrl(input.candidateWebsite ?? input.sourceUrl) &&
    domainType === "official_firm";
  const firmNameEvidence = hasStrongFirmNameEvidence(input.candidateName);
  const legalCategory = hasLegalCategoryEvidence(blob) || pageTextLooksLegal(blob);
  const domainNameSimilarity = hasDomainNameSimilarity(
    input.candidateName,
    input.candidateWebsite ?? input.sourceUrl,
  );
  const knownOrgWebsite = hasKnownOrgWebsite(
    input.candidateWebsite ?? input.sourceUrl,
    input.orgWebsite,
  );
  const officialFirmPageTitle = isOfficialFirmPageTitle(input.candidateName, {
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
  });
  const strongIdentitySignal =
    firmNameEvidence ||
    domainNameSimilarity ||
    knownOrgWebsite ||
    officialFirmPageTitle;

  breakdown.postcodeMatch = postcodeMatch;
  breakdown.firmNameEvidence = firmNameEvidence;
  breakdown.legalCategory = legalCategory;
  breakdown.officialWebsite = officialWebsite;
  breakdown.domainNameSimilarity = domainNameSimilarity;
  breakdown.knownOrgWebsite = knownOrgWebsite;
  breakdown.officialFirmPageTitle = officialFirmPageTitle;
  breakdown.strongIdentitySignal = strongIdentitySignal;

  const registerSource =
    input.sourceType === "sra_api" || input.sourceType === "local_sra";

  if (!strongIdentitySignal && !registerSource) {
    return rejectedEvaluation({
      ...baseFields,
      sraNumberMatch: false,
      sraNumberMismatch: false,
      scoreBreakdown: { ...breakdown, rejection: "missing_identity_signal" },
      rejectReason: "missing_identity_signal",
    });
  }

  let score = 0.4;
  if (postcodeMatch && firmNameEvidence && officialWebsite) {
    score = 0.9;
    breakdown.cappedAt = 0.9;
    breakdown.reason = "postcode_firm_name_official_website";
  } else if (postcodeMatch && firmNameEvidence) {
    score = 0.85;
    breakdown.cappedAt = 0.85;
    breakdown.reason = "postcode_firm_name";
  } else if (postcodeMatch && officialWebsite) {
    score = 0.65;
    breakdown.cappedAt = 0.65;
    breakdown.reason = "postcode_official_website_only";
  } else if (postcodeMatch && legalCategory) {
    score = 0.6;
    breakdown.cappedAt = 0.6;
    breakdown.reason = "postcode_legal_category";
  } else if (postcodeMatch) {
    score = 0.5;
    breakdown.cappedAt = 0.5;
    breakdown.reason = "postcode_only";
  } else if (pageTextLooksLegal(blob)) {
    score = 0.45;
    breakdown.reason = "legal_text_only";
  }

  if (domainType === "directory" || domainType === "review" || domainType === "junk") {
    score = Math.min(score, 0.65);
    breakdown.directoryCap = 0.65;
    breakdown.cappedAt = Math.min(breakdown.cappedAt ?? 0.65, 0.65);
  }

  if (input.sourceType === "sra_api" || input.sourceType === "local_sra") {
    score = Math.max(score, 0.95);
    breakdown.reason = "register_source";
  }

  if (input.sourceType === "yell" && score > 0.85) {
    score = 0.85;
    breakdown.cappedAt = 0.85;
  }

  breakdown.base = score;
  let confidence = Number(Math.min(0.99, Math.max(0, score)).toFixed(3));

  if (
    input.sourceType !== "sra_api" &&
    input.sourceType !== "local_sra" &&
    confidence < MIN_REVIEW_CONFIDENCE
  ) {
    return rejectedEvaluation({
      ...baseFields,
      sraNumberMatch: false,
      sraNumberMismatch: false,
      scoreBreakdown: { ...breakdown, rejection: "low_confidence" },
      rejectReason: "low_confidence",
    });
  }

  return {
    ...baseFields,
    sraNumberMatch: false,
    sraNumberMismatch: false,
    scoreBreakdown: breakdown,
    confidence,
    rejected: false,
  };
}

export function isWeakIdentityCandidate(
  input: CandidateEvidenceInput,
): { weak: boolean; reason?: string; evaluation: CandidateEvidenceEvaluation } {
  const evaluation = evaluateCandidateEvidence(input);

  if (evaluation.rejected) {
    return { weak: true, reason: evaluation.rejectReason, evaluation };
  }
  if (evaluation.scoreBreakdown.rejection) {
    return { weak: true, reason: evaluation.scoreBreakdown.rejection, evaluation };
  }
  if (evaluation.confidence <= 0.65) {
    return { weak: true, reason: "low_confidence", evaluation };
  }
  if (
    evaluation.scoreBreakdown.officialWebsite &&
    !evaluation.scoreBreakdown.firmNameEvidence &&
    !evaluation.sraNumberMatch
  ) {
    return { weak: true, reason: "postcode_official_only", evaluation };
  }
  if (!evaluation.sraNumberMatch && evaluation.confidence < MIN_REVIEW_CONFIDENCE) {
    return { weak: true, reason: "low_confidence", evaluation };
  }
  if (
    !evaluation.sraNumberMatch &&
    (evaluation.domainType === "directory" ||
      evaluation.domainType === "review" ||
      evaluation.domainType === "junk")
  ) {
    return { weak: true, reason: "weak_directory_evidence", evaluation };
  }

  return { weak: false, evaluation };
}
