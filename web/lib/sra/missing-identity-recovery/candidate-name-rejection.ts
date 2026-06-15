import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import { normalisePc } from "@/lib/sra/missing-identity-recovery/confidence";
import { evidenceHasExactSraNumber } from "@/lib/sra/missing-identity-recovery/sra-number-evidence";
import type { IdentitySourceType } from "@/lib/sra/missing-identity-recovery/types";

export type CandidateNameRejectReason =
  | "near_me_heading"
  | "your_source_for"
  | "pdf_title"
  | "trademark_of"
  | "using_films"
  | "article_or_news_title"
  | "directory_category_heading"
  | "non_legal_business"
  | "missing_firm_indicators"
  | "generic_page_title"
  | "yell_category_url"
  | "yell_missing_address"
  | "yell_not_legal_category"
  | "yell_category_heading"
  | "serper_bad_evidence_url"
  | "serper_weak_evidence"
  | "regulatory_or_archive_title"
  | "regulatory_source_url"
  | "directory_listing_page_title"
  | "reviews_page_title"
  | "contact_page_title"
  | "about_page_title"
  | "learn_more_page_title"
  | "legal_notices_title"
  | "top_reviews_heading"
  | "settlement_agreement_heading"
  | "town_category_solicitors_heading"
  | "us_attorney_page_title"
  | "bad_source_domain";

export type CandidateNameRejectResult =
  | { rejected: false }
  | { rejected: true; reason: CandidateNameRejectReason };

const NEAR_ME_RE = /\bnear\s+me\b/i;
const YOUR_SOURCE_RE = /\byour\s+source\s+for\b/i;
const PDF_TITLE_RE = /\[PDF\]/i;
const TRADEMARK_RE = /\btrademark\s+of\b/i;
const USING_FILMS_RE = /\busing\s+films\b/i;

const ARTICLE_NEWS_TITLE_RE =
  /\b(legal\s+news|comparative\s+law|teach\s+comparative|behind\s+the\s+law|news\s*>|magazine|journal|publication|white\s*paper|research\s+paper|lecture\s+notes)\b/i;

const DIRECTORY_CATEGORY_HEADING_RE =
  /^(?:employment\s+)?solicitors?\s+(?:near\s+me|in\s+[A-Za-z])/i;

const GENERIC_PAGE_TITLE_RE =
  /^(?:find|search|list\s+of|top\s+\d+|best\s+)\b/i;

const NON_LEGAL_BUSINESS_RE =
  /\b(hair\s+at\b|hair\s+salon|barber|beauty\s+salon|nail\s+bar|plumbing|restaurant|takeaway|florist|vet\s+clinic|dental\s+practice|accountants?\s+in)\b/i;

const FIRM_INDICATOR_RE =
  /\b(solicitors?|LLP|Legal|Law|Chambers|Attorneys?|Advocates?|Notaries?)\b/i;

const SERPER_NEWS_HOST_RE =
  /\.(edu|ac\.uk)(?:\/|$)|\b(news|press|blog|article|publication|journals?|magazine|library|repository)\b/i;

const SRA_REGULATOR_TITLE_RE = /\bsolicitors?\s+regulation\s+authority\b/i;
const DECISION_TRACKER_TITLE_RE = /\bdecision\s+tracker\b/i;
const ARCHIVE_PAGE_TITLE_RE = /\barchive\b/i;

const DIRECTORY_LISTING_PAGE_TITLE_RE =
  /\b(directory|listing|listings|news\s*page|pdf\s+page)\b/i;

const REVIEWS_PAGE_TITLE_RE = /\breviews?\s+of\b/i;
const CONTACT_PAGE_TITLE_RE = /^(?:contact(?:\s+us)?|get\s+in\s+touch)\b/i;
const ABOUT_PAGE_TITLE_RE = /\babout\s+us\b/i;
const LEARN_MORE_PAGE_TITLE_RE = /\blearn\s+more\s+about\b/i;
const LEGAL_NOTICES_TITLE_RE = /\blegal\s+notices?\b/i;
const TOP_REVIEWS_HEADING_RE = /\btop\s+solicitor\s+reviews?\b/i;
const SETTLEMENT_AGREEMENT_HEADING_RE = /\bsettlement\s+agreement\s+solicitors?\b/i;
/** Reject category headings like "London Solicitors", not firm names like "MRH Solicitors". */
const TOWN_CATEGORY_SOLICITORS_RE =
  /^[A-Z][a-z]+(?:-[A-Z][a-z]+)?\s+Solicitors?$/;
const US_ATTORNEY_PAGE_RE = /\battorney\s+at\s+law\b/i;

function rejectRegulatorySourceUrl(
  sourceUrl: string | undefined,
  sourceType?: IdentitySourceType,
): CandidateNameRejectResult {
  const u = sourceUrl?.trim() ?? "";
  if (!u) return { rejected: false };

  if (/\bsra\.org\.uk\b/i.test(u) || /\blawsociety\.org\.uk\b/i.test(u)) {
    return { rejected: true, reason: "regulatory_source_url" };
  }

  if (sourceType === "yell") {
    if (!/\/biz\//i.test(u)) {
      return { rejected: true, reason: "yell_category_url" };
    }
    return { rejected: false };
  }

  if (sourceType === "sra_api" || sourceType === "local_sra" || sourceType === "law_society") {
    return { rejected: false };
  }

  if (isRegulatoryOrDirectoryUrl(u)) {
    return { rejected: true, reason: "serper_bad_evidence_url" };
  }
  return { rejected: false };
}

export function rejectCandidateName(
  name: string,
  opts?: { sourceType?: IdentitySourceType; sourceUrl?: string },
): CandidateNameRejectResult {
  const n = name.trim();
  if (!n) return { rejected: true, reason: "generic_page_title" };

  const sourceReject = rejectRegulatorySourceUrl(opts?.sourceUrl, opts?.sourceType);
  if (sourceReject.rejected) return sourceReject;

  if (SRA_REGULATOR_TITLE_RE.test(n)) return { rejected: true, reason: "regulatory_or_archive_title" };
  if (DECISION_TRACKER_TITLE_RE.test(n)) return { rejected: true, reason: "regulatory_or_archive_title" };
  if (ARCHIVE_PAGE_TITLE_RE.test(n)) return { rejected: true, reason: "regulatory_or_archive_title" };
  if (/\bsra\.org\.uk\b/i.test(n) || /\blawsociety\.org\.uk\b/i.test(n)) {
    return { rejected: true, reason: "regulatory_or_archive_title" };
  }
  if (DIRECTORY_LISTING_PAGE_TITLE_RE.test(n)) {
    return { rejected: true, reason: "directory_listing_page_title" };
  }
  if (REVIEWS_PAGE_TITLE_RE.test(n)) return { rejected: true, reason: "reviews_page_title" };
  if (CONTACT_PAGE_TITLE_RE.test(n)) return { rejected: true, reason: "contact_page_title" };
  if (ABOUT_PAGE_TITLE_RE.test(n)) return { rejected: true, reason: "about_page_title" };
  if (LEARN_MORE_PAGE_TITLE_RE.test(n)) return { rejected: true, reason: "learn_more_page_title" };
  if (LEGAL_NOTICES_TITLE_RE.test(n)) return { rejected: true, reason: "legal_notices_title" };
  if (TOP_REVIEWS_HEADING_RE.test(n)) return { rejected: true, reason: "top_reviews_heading" };
  if (SETTLEMENT_AGREEMENT_HEADING_RE.test(n)) {
    return { rejected: true, reason: "settlement_agreement_heading" };
  }
  if (TOWN_CATEGORY_SOLICITORS_RE.test(n) && !/\b(LLP|Ltd|Limited|PLC)\b/i.test(n)) {
    return { rejected: true, reason: "town_category_solicitors_heading" };
  }
  if (US_ATTORNEY_PAGE_RE.test(n)) return { rejected: true, reason: "us_attorney_page_title" };

  if (NEAR_ME_RE.test(n)) return { rejected: true, reason: "near_me_heading" };
  if (YOUR_SOURCE_RE.test(n)) return { rejected: true, reason: "your_source_for" };
  if (PDF_TITLE_RE.test(n)) return { rejected: true, reason: "pdf_title" };
  if (TRADEMARK_RE.test(n)) return { rejected: true, reason: "trademark_of" };
  if (USING_FILMS_RE.test(n)) return { rejected: true, reason: "using_films" };
  if (ARTICLE_NEWS_TITLE_RE.test(n)) return { rejected: true, reason: "article_or_news_title" };
  if (DIRECTORY_CATEGORY_HEADING_RE.test(n)) return { rejected: true, reason: "directory_category_heading" };
  if (GENERIC_PAGE_TITLE_RE.test(n)) return { rejected: true, reason: "generic_page_title" };
  if (NON_LEGAL_BUSINESS_RE.test(n)) return { rejected: true, reason: "non_legal_business" };

  if (opts?.sourceType === "yell" && isYellCategoryHeading(n)) {
    return { rejected: true, reason: "yell_category_heading" };
  }

  if (
    opts?.sourceType === "serper" ||
    opts?.sourceType === "yell" ||
    opts?.sourceType === "google"
  ) {
    if (!hasLegalFirmNameIndicators(n)) {
      return { rejected: true, reason: "missing_firm_indicators" };
    }
  }

  return { rejected: false };
}

export function isBadIdentityCandidateName(
  name: string,
  opts?: { sourceType?: IdentitySourceType; sourceUrl?: string },
): boolean {
  return rejectCandidateName(name, opts).rejected;
}

export function hasLegalFirmNameIndicators(name: string): boolean {
  return FIRM_INDICATOR_RE.test(name.trim());
}

export function isYellCategoryHeading(name: string): boolean {
  const n = name.trim();
  if (NEAR_ME_RE.test(n)) return true;
  if (DIRECTORY_CATEGORY_HEADING_RE.test(n)) return true;
  if (/^solicitors?\s+in\s+/i.test(n) && !/\b(LLP|Ltd|Limited|PLC)\b/i.test(n)) return true;
  return false;
}

export type YellListingGateInput = {
  businessName: string;
  profileUrl: string;
  address?: string;
  categories?: string;
  phone?: string;
};

export function validateYellListing(listing: YellListingGateInput): CandidateNameRejectResult {
  const nameReject = rejectCandidateName(listing.businessName, {
    sourceType: "yell",
    sourceUrl: listing.profileUrl,
  });
  if (nameReject.rejected) return nameReject;

  if (!/\/biz\//i.test(listing.profileUrl)) {
    return { rejected: true, reason: "yell_category_url" };
  }
  if (!listing.address?.trim()) {
    return { rejected: true, reason: "yell_missing_address" };
  }

  const evidence = `${listing.businessName} ${listing.categories ?? ""} ${listing.address}`;
  if (!/\b(solicitor|solicitors|law\s+firm|lawyers?|legal|barrister|chambers)\b/i.test(evidence)) {
    return { rejected: true, reason: "yell_not_legal_category" };
  }

  return { rejected: false };
}

export function isUnacceptableSerperEvidenceUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return true;
  if (/\.pdf(?:\?|$)/i.test(u)) return true;
  if (isRegulatoryOrDirectoryUrl(u)) return true;
  try {
    const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
    const hostPath = `${parsed.hostname}${parsed.pathname}`;
    if (SERPER_NEWS_HOST_RE.test(hostPath)) return true;
    if (/\b(wikipedia|wikimedia|issuu|scribd|researchgate|academia)\b/i.test(parsed.hostname)) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

export function serperEvidenceHasSraId(
  sraId: string,
  evidenceText: string,
  title?: string,
): boolean {
  return evidenceHasExactSraNumber(sraId, title, evidenceText);
}

export function serperEvidenceHasExactPostcode(
  orgPostcode: string,
  candidatePostcode: string | undefined,
  evidenceText: string,
): boolean {
  if (!orgPostcode.trim()) return false;
  const norm = normalisePc(orgPostcode);
  if (norm.length < 5) return false;
  if (candidatePostcode?.trim() && normalisePc(candidatePostcode) !== norm) return false;
  const blob = `${evidenceText} ${candidatePostcode ?? ""}`.replace(/\s+/g, "").toUpperCase();
  return blob.includes(norm);
}

export function isOfficialFirmWebsiteUrl(url: string | undefined): boolean {
  if (!url?.trim()) return false;
  if (isUnacceptableSerperEvidenceUrl(url)) return false;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (/yell\.com|facebook|linkedin|instagram|twitter|x\.com|google\./i.test(parsed.hostname)) {
      return false;
    }
    return parsed.pathname.length <= 120;
  } catch {
    return false;
  }
}

export type SerperAutoApproveInput = {
  sraId: string;
  candidateName: string;
  sourceUrl: string;
  evidenceText: string;
  candidateWebsite?: string;
  matchedPostcode?: string;
  orgPostcode: string;
  competingMaxConfidence?: number;
};

/** Serper may auto-approve only with exact SRA number, or official site + postcode without strong competitors. */
export function canSerperAutoApprove(input: SerperAutoApproveInput): boolean {
  const nameReject = rejectCandidateName(input.candidateName, {
    sourceType: "serper",
    sourceUrl: input.sourceUrl,
  });
  if (nameReject.rejected) return false;
  if (!hasLegalFirmNameIndicators(input.candidateName)) return false;
  if (!pageEvidenceLooksLegal(input.evidenceText, input.candidateName)) return false;

  if (serperEvidenceHasSraId(input.sraId, input.evidenceText, input.candidateName)) {
    return true;
  }

  if ((input.competingMaxConfidence ?? 0) > 0.8) return false;
  if (isUnacceptableSerperEvidenceUrl(input.sourceUrl)) return false;

  const postcodeMatch = serperEvidenceHasExactPostcode(
    input.orgPostcode,
    input.matchedPostcode,
    input.evidenceText,
  );
  const officialSite =
    isOfficialFirmWebsiteUrl(input.candidateWebsite ?? input.sourceUrl) &&
    !isUnacceptableSerperEvidenceUrl(input.candidateWebsite ?? input.sourceUrl);

  return postcodeMatch && officialSite;
}

function pageEvidenceLooksLegal(evidenceText: string, name: string): boolean {
  const blob = `${evidenceText} ${name}`;
  return /\b(solicitor|solicitors|law firm|lawyers?|legal|chambers)\b/i.test(blob);
}
