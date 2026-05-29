import { firmNameTokens, nameSimilarity } from "@/lib/provider-osint/name-normalize";

const DIRECTORY_HOST_PATTERNS = [
  "yell.",
  "yelp.",
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "findlaw",
  "solicitors.law",
  "thelawpages",
  "trustpilot",
  "google.",
  "bing.com",
  "hotfrog",
  "cylex",
  "yell.com",
  "192.com",
  "checkatrade",
  "lawdepot",
];

export type OfficialDomainScore = {
  score: number;
  isDirectory: boolean;
  nameOverlap: number;
  signals: string[];
};

export function scoreOfficialDomain(
  websiteUrl: string,
  firmName: string,
  opts?: { postcode?: string; city?: string },
): OfficialDomainScore {
  const signals: string[] = [];
  let score = 0.35;

  let hostname = "";
  try {
    const url = new URL(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`);
    hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { score: 0, isDirectory: true, nameOverlap: 0, signals: ["invalid_url"] };
  }

  const isDirectory = DIRECTORY_HOST_PATTERNS.some((p) => hostname.includes(p));
  if (isDirectory) {
    return { score: 0.15, isDirectory: true, nameOverlap: 0, signals: ["directory_host"] };
  }

  const tokens = firmNameTokens(firmName);
  const hostCompact = hostname.replace(/[^a-z0-9]/g, "");
  let matchedTokens = 0;
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (hostCompact.includes(t)) {
      matchedTokens++;
      signals.push(`host_contains:${t}`);
    }
  }

  const nameOverlap =
    tokens.length > 0 ? matchedTokens / tokens.length : nameSimilarity(firmName, hostname);
  score += nameOverlap * 0.45;

  if (hostname.endsWith(".co.uk") || hostname.endsWith(".org.uk") || hostname.endsWith(".uk")) {
    score += 0.08;
    signals.push("uk_tld");
  }

  if (hostname.endsWith(".gov.uk")) {
    score -= 0.2;
    signals.push("gov_host");
  }

  if (opts?.postcode && hostname.length > 4) {
    score += 0.03;
  }

  const finalScore = Math.min(1, Math.max(0, Math.round(score * 100) / 100));
  return {
    score: finalScore,
    isDirectory,
    nameOverlap,
    signals,
  };
}

/** High confidence auto-approve threshold for official firm sites. */
export const OFFICIAL_DOMAIN_AUTO_APPROVE = 0.88;
export const OFFICIAL_DOMAIN_REVIEW_FLOOR = 0.55;

export function websiteNeedsReviewFromDomain(domain: OfficialDomainScore): boolean {
  if (domain.isDirectory) return true;
  return domain.score < OFFICIAL_DOMAIN_AUTO_APPROVE;
}
