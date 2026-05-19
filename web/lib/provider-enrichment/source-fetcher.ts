/** Approved host suffixes for provider page fetch (enrichment only). */
const ALLOWED_HOST_SUFFIXES = [
  "gov.uk",
  "lawsociety.org.uk",
  "sra.org.uk",
  "lawcentrenetwork.org.uk",
  "citizensadvice.org.uk",
  "adviceuk.org.uk",
];

export type FetchedPage = {
  url: string;
  html: string;
  text: string;
  fetchedAt: number;
};

function hostAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return true;
    return false;
  } catch {
    return false;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch an approved source page. Skips when PROVIDER_ENRICHMENT_SKIP_FETCH=1 (eval/CI).
 */
export async function fetchApprovedSourcePage(url: string): Promise<FetchedPage | null> {
  if (process.env.PROVIDER_ENRICHMENT_SKIP_FETCH === "1") return null;
  if (!url?.startsWith("http")) return null;
  if (!hostAllowed(url)) return null;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "LegalShaman-Enrichment/1.0 (+signposting)" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length > 2_000_000) return null;
    return {
      url,
      html,
      text: htmlToText(html),
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function isAllowedEnrichmentUrl(url: string): boolean {
  return hostAllowed(url);
}
