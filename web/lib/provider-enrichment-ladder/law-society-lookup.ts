import { fetchApprovedSourcePage } from "@/lib/provider-enrichment/source-fetcher";
import { extractWebsiteFromText } from "@/lib/provider-enrichment/contact-extractor";
import type { WebsiteDiscoveryCandidate } from "@/lib/provider-enrichment-ladder/types";
import { ladderConfidence } from "@/lib/provider-enrichment-ladder/enrichment-confidence";

const FIND_BASE = "https://solicitors.lawsociety.org.uk/search/results";

/** Build Law Society Find a Solicitor search URL (no invented results). */
export function lawSocietySearchUrl(args: {
  name: string;
  city?: string;
  postcode?: string;
}): string {
  const params = new URLSearchParams();
  params.set("Term", args.name.trim());
  if (args.postcode?.trim()) params.set("Postcode", args.postcode.trim());
  else if (args.city?.trim()) params.set("Location", args.city.trim());
  return `${FIND_BASE}?${params.toString()}`;
}

const DIRECTORY_HOSTS = [
  "yell.com",
  "yelp.",
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "instagram.com",
  "find-open.co.uk",
  "trustpilot.",
  "google.com",
  "bing.com",
];

function isRejectedDirectoryHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return DIRECTORY_HOSTS.some((d) => h.includes(d));
}

function extractProfileLinks(html: string): string[] {
  const links: string[] = [];
  const re = /href="(https:\/\/solicitors\.lawsociety\.org\.uk\/person\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    links.push(m[1].replace(/&amp;/g, "&"));
  }
  return [...new Set(links)];
}

function extractWebsiteFromProfileHtml(html: string, profileUrl: string): WebsiteDiscoveryCandidate | null {
  const text = html.replace(/<[^>]+>/g, " ");
  const site = extractWebsiteFromText(text, profileUrl);
  if (!site) return null;
  try {
    const host = new URL(site.startsWith("http") ? site : `https://${site}`).hostname;
    if (isRejectedDirectoryHost(host)) return null;
    if (host.includes("lawsociety.org.uk") || host.includes("sra.org.uk")) return null;
  } catch {
    return null;
  }
  const confidence = ladderConfidence({
    sourceType: "law_society",
    extractionConfidence: 0.82,
    signal: "law_society_profile",
  });
  return {
    url: site.startsWith("http") ? site : `https://${site}`,
    confidence,
    sourceType: "law_society",
    sourceUrl: profileUrl,
    provenanceNote: "Law Society solicitor profile website field",
    needsReview: confidence < 0.9,
  };
}

/**
 * Attempt Law Society lookup: fetch search results, open first profile, extract website.
 * Returns null if fetch blocked or no verifiable website found.
 */
export async function discoverWebsiteViaLawSociety(args: {
  name: string;
  city?: string;
  postcode?: string;
}): Promise<WebsiteDiscoveryCandidate | null> {
  const searchUrl = lawSocietySearchUrl(args);
  const searchPage = await fetchApprovedSourcePage(searchUrl);
  if (!searchPage?.html) return null;

  const profiles = extractProfileLinks(searchPage.html);
  if (!profiles.length) return null;

  const profileUrl = profiles[0];
  const profilePage = await fetchApprovedSourcePage(profileUrl);
  if (!profilePage?.html) return null;

  return extractWebsiteFromProfileHtml(profilePage.html, profileUrl);
}
