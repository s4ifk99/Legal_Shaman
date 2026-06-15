import {
  rejectCandidateName,
  type CandidateNameRejectReason,
} from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import {
  classifySraStoredName,
  isAddressLikeName,
  isPlaceholderSraDisplayName,
  isUsableFirmNameCandidate,
} from "@/lib/sra/sra-name-quality";
export const INVALID_FIRM_NAME_SEED_REASON = "invalid_firm_name_seed";

const COUNTRY_ONLY_RE =
  /^(United Kingdom|UK|England|Scotland|Wales|Northern Ireland|Ireland|France|Germany|Spain|Italy|Kenya|Greece|UAE|United Arab Emirates)$/i;

const CITY_ONLY_RE = /^[A-Za-z\s.'-]{2,40}$/;

const NEWS_MEDIA_HOST_RE = /(^|\.)legalnews\.com$/i;

function firmNameLooksLikeSraId(name: string, sraId?: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (sraId && (n === sraId || n === `sra:${sraId}`)) return true;
  if (/^Organisation\s+\d+$/i.test(n)) return true;
  if (/^\d{5,}$/.test(n)) return true;
  return false;
}

export type FirmNameSeedRejectResult =
  | { valid: true }
  | { valid: false; reason: typeof INVALID_FIRM_NAME_SEED_REASON; detail: CandidateNameRejectReason | string };

/** Reuse identity recovery name gates before website search / query building. */
export function rejectFirmNameSeed(name: string, sraId: string): FirmNameSeedRejectResult {
  const n = name.trim();
  if (!n) {
    return { valid: false, reason: INVALID_FIRM_NAME_SEED_REASON, detail: "empty_name" };
  }

  if (firmNameLooksLikeSraId(n, sraId) || isPlaceholderSraDisplayName(n, sraId)) {
    return { valid: false, reason: INVALID_FIRM_NAME_SEED_REASON, detail: "placeholder_or_id" };
  }

  const nameReject = rejectCandidateName(n);
  if (nameReject.rejected) {
    return {
      valid: false,
      reason: INVALID_FIRM_NAME_SEED_REASON,
      detail: nameReject.reason,
    };
  }

  const classification = classifySraStoredName(n, sraId);
  if (classification === "address_like_name") {
    return { valid: false, reason: INVALID_FIRM_NAME_SEED_REASON, detail: "address_like_name" };
  }
  if (classification === "placeholder" || classification === "id_only" || classification === "empty") {
    return { valid: false, reason: INVALID_FIRM_NAME_SEED_REASON, detail: classification };
  }

  if (COUNTRY_ONLY_RE.test(n)) {
    return { valid: false, reason: INVALID_FIRM_NAME_SEED_REASON, detail: "country_only" };
  }
  if (CITY_ONLY_RE.test(n) && !/\b(LLP|Ltd|Limited|Solicitors?|Law|Chambers|Legal)\b/i.test(n)) {
    return { valid: false, reason: INVALID_FIRM_NAME_SEED_REASON, detail: "town_only" };
  }
  if (isAddressLikeName(n)) {
    return { valid: false, reason: INVALID_FIRM_NAME_SEED_REASON, detail: "address_like_name" };
  }
  if (!isUsableFirmNameCandidate(n, sraId)) {
    return { valid: false, reason: INVALID_FIRM_NAME_SEED_REASON, detail: "not_usable_firm_name" };
  }

  return { valid: true };
}

export function isValidFirmNameSeed(name: string, sraId: string): boolean {
  return rejectFirmNameSeed(name, sraId).valid;
}

/** True when display_name should be reverted to SRA placeholder after bad recovery. */
export function isBadRecoveredDisplayName(name: string, sraId: string): boolean {
  return !rejectFirmNameSeed(name, sraId).valid;
}

export function isNewsOrMediaWebsiteHost(url: string): boolean {
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
    return NEWS_MEDIA_HOST_RE.test(host);
  } catch {
    return false;
  }
}

/** Reject news/media sites when the firm seed is not a real legal practice name. */
export function rejectWebsiteForInvalidFirmSeed(
  url: string,
  firmName: string,
  sraId: string,
): { reject: boolean; reason?: string } {
  const seedReject = rejectFirmNameSeed(firmName, sraId);
  if (!seedReject.valid) {
    return { reject: true, reason: INVALID_FIRM_NAME_SEED_REASON };
  }
  if (isNewsOrMediaWebsiteHost(url)) {
    return { reject: true, reason: "news_media_domain" };
  }
  return { reject: false };
}
