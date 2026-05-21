import { isUrlAllowedByRobots, CRAWLER_USER_AGENT } from "@/lib/provider-crawler/robots";

const APPROVED_DIRECTORY_SUFFIXES = [
  "gov.uk",
  "lawsociety.org.uk",
  "sra.org.uk",
  "lawcentrenetwork.org.uk",
  "citizensadvice.org.uk",
  "adviceuk.org.uk",
];

/** Hosts we never scrape (Trustpilot HTML; use official API only). */
const BLOCKED_HOST_SUFFIXES = ["trustpilot.com", "trustpilot.co.uk"];

const lastFetchByHost = new Map<string, number>();
const MIN_INTERVAL_MS = Number(process.env.PROVIDER_CRAWL_MIN_INTERVAL_MS ?? "1000");

export type FetchedPage = {
  url: string;
  html: string;
  text: string;
  fetchedAt: number;
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return BLOCKED_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

function isApprovedDirectoryHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return APPROVED_DIRECTORY_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** Provider's own website hostname (must match registered website on the entity). */
export function isProviderOfficialHost(websiteUrl: string | undefined, fetchUrl: string): boolean {
  if (!websiteUrl) return false;
  try {
    const official = new URL(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`);
    const target = new URL(fetchUrl);
    return (
      official.hostname.toLowerCase() === target.hostname.toLowerCase() ||
      target.hostname.toLowerCase().endsWith(`.${official.hostname.toLowerCase()}`)
    );
  } catch {
    return false;
  }
}

export function isAllowedCrawlUrl(
  url: string,
  opts?: { officialWebsite?: string },
): { allowed: boolean; reason?: string } {
  if (!url?.startsWith("http")) return { allowed: false, reason: "not_http" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }
  if (hostBlocked(parsed.hostname)) {
    return { allowed: false, reason: "trustpilot_scrape_blocked" };
  }
  if (isApprovedDirectoryHost(parsed.hostname)) return { allowed: true };
  if (opts?.officialWebsite && isProviderOfficialHost(opts.officialWebsite, url)) {
    return { allowed: true };
  }
  return { allowed: false, reason: "host_not_allowlisted" };
}

async function rateLimitHost(hostname: string): Promise<void> {
  const last = lastFetchByHost.get(hostname) ?? 0;
  const wait = MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchByHost.set(hostname, Date.now());
}

export type FetchPageResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; reason: string };

/**
 * Compliant page fetch: allowlist, robots.txt, rate limit. No CAPTCHA/login bypass.
 */
export async function fetchCrawlPage(
  url: string,
  opts?: { officialWebsite?: string },
): Promise<FetchPageResult> {
  if (process.env.PROVIDER_CRAWL_SKIP_FETCH === "1") {
    return { ok: false, reason: "skip_fetch_env" };
  }

  const allow = isAllowedCrawlUrl(url, opts);
  if (!allow.allowed) return { ok: false, reason: allow.reason ?? "not_allowed" };

  const robots = await isUrlAllowedByRobots(url, CRAWLER_USER_AGENT);
  if (!robots.allowed) return { ok: false, reason: robots.reason ?? "robots_disallow" };

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  await rateLimitHost(hostname);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "access_denied" };
    }
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return { ok: false, reason: "not_html" };
    }

    const html = await res.text();
    if (html.length > 2_000_000) return { ok: false, reason: "page_too_large" };

    if (/captcha|recaptcha|hcaptcha|cloudflare challenge/i.test(html.slice(0, 8000))) {
      return { ok: false, reason: "captcha_detected" };
    }

    return {
      ok: true,
      page: {
        url,
        html,
        text: htmlToText(html),
        fetchedAt: Date.now(),
      },
    };
  } catch {
    return { ok: false, reason: "fetch_error" };
  }
}

export function findContactPageLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const re = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!/contact|get-in-touch|enquir/i.test(href)) continue;
    try {
      const abs = new URL(href, baseUrl).href;
      links.push(abs);
    } catch {
      /* skip */
    }
  }
  return [...new Set(links)].slice(0, 3);
}
