import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import {
  isSerperApiConfigured,
  searchSerperOrganic,
  type SerperOrganicResult,
} from "@/lib/search/serper-client";

export type FirmWebSearchHit = {
  url: string;
  title: string;
  snippet: string;
  query: string;
  sourceProvider?: "serper" | "duckduckgo";
};

export type FirmWebSearchQueryTrace = {
  query: string;
  provider: "serper" | "duckduckgo" | "none";
  resultCount: number;
  first3Results: { title: string; link: string }[];
  ok: boolean;
  error?: string;
};

export type FirmWebSearchRunResult = {
  hits: FirmWebSearchHit[];
  queriesRun: number;
  searchProvider: "serper" | "duckduckgo" | "mixed" | "none";
  apiConfigured: boolean;
  searchesAttempted: number;
  searchesSucceeded: number;
  searchesFailed: number;
  totalResultsReturned: number;
  queryTraces: FirmWebSearchQueryTrace[];
};

const RESULT_LINK_RE =
  /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const UDDG_RE = /uddg=([^&"]+)/;

function decodeDdgRedirect(href: string): string | null {
  try {
    if (href.startsWith("//")) href = `https:${href}`;
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (u.hostname.includes("duckduckgo.com")) return null;
    return u.href;
  } catch {
    return null;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function originFromUrl(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function extractResultsFromHtml(html: string, query: string): FirmWebSearchHit[] {
  const hits: FirmWebSearchHit[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  const re = RESULT_LINK_RE;
  while ((m = re.exec(html))) {
    let rawHref = m[1]!.replace(/&amp;/g, "&");
    let url = decodeDdgRedirect(rawHref);
    if (!url) {
      const uddg = rawHref.match(UDDG_RE);
      if (uddg) url = decodeURIComponent(uddg[1]!);
    }
    if (!url?.startsWith("http")) continue;
    if (isRegulatoryOrDirectoryUrl(url)) continue;

    const origin = originFromUrl(url);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);

    hits.push({
      url: origin,
      title: stripHtml(m[2] ?? ""),
      snippet: "",
      query,
      sourceProvider: "duckduckgo",
    });
    if (hits.length >= 8) break;
  }

  if (!hits.length) {
    const linkRe = /href="(https?:\/\/[^"]+)"/gi;
    while ((m = linkRe.exec(html))) {
      const url = m[1]!.replace(/&amp;/g, "&");
      if (!url.startsWith("http")) continue;
      if (/duckduckgo|duck\.co/i.test(url)) continue;
      if (isRegulatoryOrDirectoryUrl(url)) continue;
      const origin = originFromUrl(url);
      if (!origin || seen.has(origin)) continue;
      seen.add(origin);
      hits.push({ url: origin, title: "", snippet: "", query, sourceProvider: "duckduckgo" });
      if (hits.length >= 8) break;
    }
  }

  return hits;
}

let lastDdgSearchAt = 0;
const DDG_INTERVAL_MS = Number(process.env.PROVIDER_WEBSITE_SEARCH_INTERVAL_MS ?? "1200");

async function rateLimitDdg(): Promise<void> {
  const wait = DDG_INTERVAL_MS - (Date.now() - lastDdgSearchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastDdgSearchAt = Date.now();
}

export function mapSerperOrganicToFirmHits(
  organic: SerperOrganicResult[],
  query: string,
): FirmWebSearchHit[] {
  const hits: FirmWebSearchHit[] = [];
  const seen = new Set<string>();

  for (const row of organic) {
    if (isRegulatoryOrDirectoryUrl(row.link)) continue;
    const origin = originFromUrl(row.link);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    hits.push({
      url: origin,
      title: row.title,
      snippet: row.snippet,
      query,
      sourceProvider: "serper",
    });
    if (hits.length >= 8) break;
  }

  return hits;
}

async function searchDuckDuckGo(query: string): Promise<FirmWebSearchHit[]> {
  await rateLimitDdg();
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "LegalShaman-WebsiteDiscovery/1.0 (+signposting)",
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    return extractResultsFromHtml(html, query);
  } catch {
    return [];
  }
}

function summarizeProvider(traces: FirmWebSearchQueryTrace[]): FirmWebSearchRunResult["searchProvider"] {
  const used = new Set(traces.map((t) => t.provider).filter((p) => p !== "none"));
  if (!used.size) return "none";
  if (used.size === 1) return [...used][0] as "serper" | "duckduckgo";
  return "mixed";
}

/** Plan primary provider without network (for evals). */
export function planFirmWebSearchProvider(): {
  apiConfigured: boolean;
  primary: "serper" | "duckduckgo";
} {
  const apiConfigured = isSerperApiConfigured();
  return { apiConfigured, primary: apiConfigured ? "serper" : "duckduckgo" };
}

/**
 * Firm website search: Serper when SERPER_API_KEY is set, DuckDuckGo HTML as fallback on failure.
 */
export async function searchWebForFirmQueries(
  queries: string[],
): Promise<FirmWebSearchRunResult> {
  const apiConfigured = isSerperApiConfigured();
  const base: FirmWebSearchRunResult = {
    hits: [],
    queriesRun: 0,
    searchProvider: "none",
    apiConfigured,
    searchesAttempted: 0,
    searchesSucceeded: 0,
    searchesFailed: 0,
    totalResultsReturned: 0,
    queryTraces: [],
  };

  if (process.env.PROVIDER_WEBSITE_SEARCH_SKIP === "1") {
    return base;
  }

  const all: FirmWebSearchHit[] = [];
  const seenOrigins = new Set<string>();
  const queryTraces: FirmWebSearchQueryTrace[] = [];
  let searchesAttempted = 0;
  let searchesSucceeded = 0;
  let searchesFailed = 0;

  for (const query of queries) {
    searchesAttempted++;
    let hits: FirmWebSearchHit[] = [];
    let provider: FirmWebSearchQueryTrace["provider"] = "none";
    let ok = false;
    let error: string | undefined;

    if (apiConfigured) {
      const serper = await searchSerperOrganic({
        q: query,
        gl: "uk",
        num: 10,
        cacheChannel: "firm-website-serper",
      });
      if (serper.ok) {
        hits = mapSerperOrganicToFirmHits(serper.results, query);
        provider = "serper";
        ok = true;
      } else {
        error = serper.error;
        hits = await searchDuckDuckGo(query);
        provider = "duckduckgo";
        ok = hits.length > 0;
      }
    } else {
      hits = await searchDuckDuckGo(query);
      provider = "duckduckgo";
      ok = true;
    }

    if (ok) searchesSucceeded++;
    else searchesFailed++;

    const rawForTrace = hits.map((h) => ({
      title: h.title,
      link: h.url,
    }));

    queryTraces.push({
      query,
      provider,
      resultCount: hits.length,
      first3Results: rawForTrace.slice(0, 3),
      ok,
      error,
    });

    for (const hit of hits) {
      if (seenOrigins.has(hit.url)) continue;
      seenOrigins.add(hit.url);
      all.push(hit);
    }

    if (all.length >= 12) break;
  }

  return {
    hits: all,
    queriesRun: queries.length,
    searchProvider: summarizeProvider(queryTraces),
    apiConfigured,
    searchesAttempted,
    searchesSucceeded,
    searchesFailed,
    totalResultsReturned: all.length,
    queryTraces,
  };
}
