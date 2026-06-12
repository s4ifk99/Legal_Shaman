import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import { firmNameTokens, postcodeMatches, cityMatches } from "@/lib/provider-osint/name-normalize";
import type { FirmNameSeed } from "@/lib/provider-osint/firm-name-seed";

export type HomepageVerification = {
  verified: boolean;
  title?: string;
  matchedFirmTokens: string[];
  matchedLocation: boolean;
  hasLegalKeywords: boolean;
  fetchOk: boolean;
  reason?: string;
};

const LEGAL_KEYWORD_RE =
  /\b(solicitor|solicitors|law firm|barrister|legal services|lawyers?|chambers)\b/i;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]!) : "";
}

export async function fetchHomepageForVerification(url: string): Promise<{
  ok: boolean;
  html?: string;
  text?: string;
  reason?: string;
}> {
  if (process.env.PROVIDER_WEBSITE_VERIFY_SKIP_FETCH === "1") {
    return { ok: false, reason: "skip_fetch_env" };
  }
  if (!url?.startsWith("http") || isRegulatoryOrDirectoryUrl(url)) {
    return { ok: false, reason: "blocked_url" };
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "LegalShaman-WebsiteDiscovery/1.0 (+signposting)" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return { ok: false, reason: "not_html" };
    }
    const html = await res.text();
    if (html.length > 2_000_000) return { ok: false, reason: "page_too_large" };
    return { ok: true, html, text: htmlToText(html) };
  } catch {
    return { ok: false, reason: "fetch_error" };
  }
}

export function verifyHomepageContent(
  text: string,
  title: string,
  seed: FirmNameSeed,
  opts?: { postcodeInPage?: boolean },
): HomepageVerification {
  const combined = `${title} ${text}`.toLowerCase();
  const tokens = firmNameTokens(seed.primaryName).filter((t) => t.length >= 3);
  const matchedFirmTokens = tokens.filter((t) => combined.includes(t));

  const matchedLocation =
    (seed.postcode && postcodeMatches(seed.postcode, combined)) ||
    (seed.city && cityMatches(seed.city, combined)) ||
    Boolean(opts?.postcodeInPage);

  const hasLegalKeywords = LEGAL_KEYWORD_RE.test(combined);
  const nameMatchRatio = tokens.length ? matchedFirmTokens.length / tokens.length : 0;

  const verified =
    matchedFirmTokens.length >= 1 &&
    (nameMatchRatio >= 0.34 || (matchedFirmTokens.length >= 2 && hasLegalKeywords));

  return {
    verified,
    title,
    matchedFirmTokens,
    matchedLocation,
    hasLegalKeywords,
    fetchOk: true,
    reason: verified ? undefined : "firm_name_not_on_page",
  };
}

export async function verifyFirmWebsiteHomepage(
  url: string,
  seed: FirmNameSeed,
): Promise<HomepageVerification> {
  const fetched = await fetchHomepageForVerification(url);
  if (!fetched.ok || !fetched.text) {
    return {
      verified: false,
      matchedFirmTokens: [],
      matchedLocation: false,
      hasLegalKeywords: false,
      fetchOk: false,
      reason: fetched.reason ?? "fetch_failed",
    };
  }

  const title = fetched.html ? extractTitle(fetched.html) : "";
  const postcodeInPage = seed.postcode
    ? fetched.text.toUpperCase().includes(seed.postcode.replace(/\s/g, "").toUpperCase().slice(0, 4))
    : false;

  return verifyHomepageContent(fetched.text, title, seed, { postcodeInPage });
}
