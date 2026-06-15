import { scoreOfficialDomain } from "@/lib/provider-osint/official-domain-scoring";

/** Standard rejection reason for website field candidates. */
export const REGULATORY_REJECT_REASON = "regulatory_url_not_provider_website";

const ALWAYS_REGULATORY_HOST_SUFFIXES = [
  "sra.org.uk",
  "legalservices.gov.uk",
  "justice.gov.uk",
  "find-legal-advice.justice.gov.uk",
];

const REGULATORY_GOV_UK_PATH_RE =
  /\/(find-a-solicitor|find\.solicitor|solicitors|register|directory|legal-aid|legalaid|providers?|organisation|organization|firm-details|profile|search)\b/i;

const DIRECTORY_HOST_FRAGMENTS = [
  "yell.",
  "yelp.",
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "findlaw",
  "thelawpages",
  "trustpilot",
  "google.",
  "bing.com",
  "hotfrog",
  "cylex",
  "192.com",
  "checkatrade",
  "lawdepot",
  "lawworks.org.uk",
];

const LAW_SOCIETY_DIRECTORY_PATH_RE =
  /\/(find-a-solicitor|solicitors|search|directory|profile)\b/i;

function parseUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    return new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const h = hostname.toLowerCase();
  return h === suffix || h.endsWith(`.${suffix}`);
}

function isDirectoryHost(hostname: string, pathname: string): boolean {
  const h = hostname.toLowerCase();
  if (DIRECTORY_HOST_FRAGMENTS.some((frag) => h.includes(frag))) return true;
  if (hostMatchesSuffix(h, "lawsociety.org.uk") && LAW_SOCIETY_DIRECTORY_PATH_RE.test(pathname)) {
    return true;
  }
  if (hostMatchesSuffix(h, "lawworks.org.uk") && /directory|search/i.test(pathname)) {
    return true;
  }
  return false;
}

/** True when URL must never become a provider website field (provenance only). */
export function isRegulatoryOrDirectoryUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  if (ALWAYS_REGULATORY_HOST_SUFFIXES.some((s) => hostMatchesSuffix(hostname, s))) {
    return true;
  }

  if (hostname.endsWith(".gov.uk")) {
    if (REGULATORY_GOV_UK_PATH_RE.test(pathname)) return true;
    if (/legal.?aid|directory|providers|find-legal-advice/i.test(pathname)) return true;
  }

  if (isDirectoryHost(hostname, pathname)) return true;

  return false;
}

/** @deprecated Use isRegulatoryOrDirectoryUrl */
export function isRegulatoryUrl(url: string): boolean {
  return isRegulatoryOrDirectoryUrl(url);
}

const WEBSITE_CONTACT_FIELDS = new Set(["website", "contact_page", "contactPageUrl"]);

export type RegulatoryEnrichmentBlock = {
  block: boolean;
  reason?: string;
};

export function shouldBlockRegulatoryEnrichment(
  fieldName: string,
  extractedValue: string,
  sourceUrl?: string,
): RegulatoryEnrichmentBlock {
  const fn = fieldName === "contactPageUrl" ? "contact_page" : fieldName;
  if (!WEBSITE_CONTACT_FIELDS.has(fn)) return { block: false };

  if (isRegulatoryOrDirectoryUrl(extractedValue)) {
    return { block: true, reason: REGULATORY_REJECT_REASON };
  }
  if (sourceUrl && isRegulatoryOrDirectoryUrl(sourceUrl) && fn === "website") {
    return { block: true, reason: REGULATORY_REJECT_REASON };
  }
  return { block: false };
}

export function regulatoryProvenanceNote(url: string, reason: string): string {
  return `regulatory_provenance:${reason}:${url.slice(0, 200)}`;
}

export type ProviderWebsiteEvaluation = {
  accept: boolean;
  reason?: string;
  provenanceOnly?: boolean;
};

/** Gate for firm website candidates after URL/host checks. */
export function evaluateProviderWebsiteCandidate(
  url: string,
  firmName: string,
  opts?: { minDomainScore?: number },
): ProviderWebsiteEvaluation {
  const minScore = opts?.minDomainScore ?? 0.55;

  if (isRegulatoryOrDirectoryUrl(url)) {
    return { accept: false, reason: REGULATORY_REJECT_REASON, provenanceOnly: true };
  }

  const domain = scoreOfficialDomain(url, firmName);
  if (domain.isDirectory) {
    return { accept: false, reason: "directory_host", provenanceOnly: true };
  }
  if (domain.score < minScore) {
    return { accept: false, reason: "domain_score_too_low" };
  }

  return { accept: true };
}

export function sraRegisterProvenanceUrl(doc: {
  profileUrl?: string;
  sraId?: string;
  id?: string;
}): string | undefined {
  if (doc.profileUrl?.startsWith("http")) return doc.profileUrl;
  if (doc.sraId) {
    return `https://www.sra.org.uk/consumers/solicitor-check/?searchText=${encodeURIComponent(doc.sraId)}`;
  }
  return undefined;
}
