import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import { isSyntheticWebsiteDomain } from "@/lib/provider-osint/synthetic-domain";
import {
  classifySraStoredName,
  isAddressLikeName,
  isPlaceholderSraDisplayName,
  isUsableFirmNameCandidate,
} from "@/lib/sra/sra-name-quality";
import {
  isUnacceptableSerperEvidenceUrl,
  rejectCandidateName,
} from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import type { SraIdentityCandidateRecord } from "@/lib/sra/missing-identity-recovery/types";

const COUNTRY_ONLY_RE =
  /^(United Kingdom|UK|England|Scotland|Wales|Northern Ireland|Ireland|France|Germany|Spain|Italy)$/i;

const CITY_ONLY_RE = /^[A-Za-z\s.'-]{2,40}$/;

export type ValidationResult =
  | { ok: true; candidate: SraIdentityCandidateRecord }
  | { ok: false; reason: string };

export function validateIdentityCandidate(
  raw: Omit<SraIdentityCandidateRecord, "status" | "confidence"> & { confidence: number },
  sraId: string,
): ValidationResult {
  const name = raw.candidateName.trim();
  if (!name) return { ok: false, reason: "empty_name" };
  if (!raw.sourceUrl?.trim()) return { ok: false, reason: "missing_evidence_url" };

  const nameReject = rejectCandidateName(name, {
    sourceType: raw.sourceType,
    sourceUrl: raw.sourceUrl,
  });
  if (nameReject.rejected) return { ok: false, reason: nameReject.reason };

  if (raw.sourceType === "serper" || raw.sourceType === "google") {
    if (isUnacceptableSerperEvidenceUrl(raw.sourceUrl)) {
      return { ok: false, reason: "serper_bad_evidence_url" };
    }
  }

  const classification = classifySraStoredName(name, sraId);
  if (classification === "address_like_name") {
    return { ok: false, reason: "address_like_name" };
  }
  if (classification === "placeholder" || classification === "id_only") {
    return { ok: false, reason: "placeholder_or_id" };
  }
  if (COUNTRY_ONLY_RE.test(name)) return { ok: false, reason: "country_only" };
  if (CITY_ONLY_RE.test(name) && !/\b(LLP|Ltd|Limited|Solicitors?|Law)\b/i.test(name)) {
    return { ok: false, reason: "town_only" };
  }
  if (!isUsableFirmNameCandidate(name, sraId)) {
    return { ok: false, reason: "not_usable_firm_name" };
  }

  if (raw.candidateWebsite) {
    const site = raw.candidateWebsite.trim();
    if (isRegulatoryOrDirectoryUrl(site)) {
      return { ok: false, reason: "regulatory_or_directory_website" };
    }
    if (isSyntheticWebsiteDomain(site, name, { sraId, postcode: raw.matchedPostcode, city: raw.matchedTown }).synthetic) {
      return { ok: false, reason: "synthetic_domain" };
    }
  }

  if (
    raw.sourceType !== "sra_api" &&
    raw.sourceType !== "local_sra" &&
    !pageHasLegalSignal(raw.evidenceText, name)
  ) {
    return { ok: false, reason: "weak_legal_evidence" };
  }

  return {
    ok: true,
    candidate: {
      ...raw,
      candidateName: name,
      status: "pending_review",
    },
  };
}

function pageHasLegalSignal(evidenceText: string, name: string): boolean {
  const blob = `${evidenceText} ${name}`;
  if (/\b(solicitor|solicitors|law firm|lawyers?|legal|chambers)\b/i.test(blob)) {
    return true;
  }
  if (/\b(LLP|Ltd|Limited|PLC)\b/i.test(name)) return true;
  return false;
}

export function isAddressLikeCandidateName(name: string): boolean {
  return isAddressLikeName(name) || isPlaceholderSraDisplayName(name);
}
