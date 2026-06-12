import {
  getCachedSearch,
  rateLimitSearch,
  setCachedSearch,
} from "@/lib/sra/missing-identity-recovery/search-cache";

export type SerperSearchProvider = "serper";

export type SerperOrganicResult = {
  title: string;
  link: string;
  snippet: string;
  sourceProvider: SerperSearchProvider;
};

export type SerperSearchResponse = {
  ok: boolean;
  /** No SERPER_API_KEY configured. */
  disabled: boolean;
  status?: number;
  results: SerperOrganicResult[];
  error?: string;
};

export type SerperPingResult = {
  ok: boolean;
  apiKeyPresent: boolean;
  status?: number;
  organicCount: number;
  error?: string;
};

const SERPER_URL = "https://google.serper.dev/search";

export function isSerperApiConfigured(): boolean {
  return Boolean(process.env.SERPER_API_KEY?.trim());
}

/** Parse Serper JSON organic array (for tests and client). */
export function parseSerperOrganicPayload(data: unknown): SerperOrganicResult[] {
  if (!data || typeof data !== "object") return [];
  const organic = (data as { organic?: unknown }).organic;
  if (!Array.isArray(organic)) return [];

  const out: SerperOrganicResult[] = [];
  for (const row of organic) {
    if (!row || typeof row !== "object") continue;
    const o = row as { title?: string; link?: string; snippet?: string };
    const link = o.link?.trim() ?? "";
    if (!link.startsWith("http")) continue;
    out.push({
      title: o.title?.trim() ?? "",
      link,
      snippet: o.snippet?.trim() ?? "",
      sourceProvider: "serper",
    });
  }
  return out;
}

function logSerperFailure(status: number, bodySnippet: string, query: string): void {
  console.warn(
    JSON.stringify({
      event: "serper_search_failed",
      status,
      query: query.slice(0, 120),
      bodySnippet: bodySnippet.slice(0, 200),
    }),
  );
}

export type SearchSerperOrganicOptions = {
  q: string;
  gl?: string;
  num?: number;
  cacheChannel?: string;
  skipCache?: boolean;
};

/**
 * POST google.serper.dev/search. Never logs the API key.
 */
export async function searchSerperOrganic(
  opts: SearchSerperOrganicOptions,
): Promise<SerperSearchResponse> {
  const q = opts.q.trim();
  if (!q) {
    return { ok: false, disabled: false, results: [], error: "empty_query" };
  }

  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) {
    return { ok: false, disabled: true, results: [], error: "serper_api_key_missing" };
  }

  const channel = opts.cacheChannel;
  if (channel && !opts.skipCache) {
    const cached = await getCachedSearch<SerperOrganicResult[]>(channel, q);
    if (cached) {
      return { ok: true, disabled: false, status: 200, results: cached };
    }
  }

  await rateLimitSearch(
    Number(process.env.SEARCH_PROVIDER_DELAY_MS ?? process.env.SRA_IDENTITY_SEARCH_DELAY_MS),
  );

  try {
    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q,
        gl: opts.gl ?? "uk",
        num: opts.num ?? 10,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const rawText = await res.text();
    if (!res.ok) {
      logSerperFailure(res.status, rawText, q);
      return {
        ok: false,
        disabled: false,
        status: res.status,
        results: [],
        error: `http_${res.status}`,
      };
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText) as unknown;
    } catch {
      logSerperFailure(res.status, rawText, q);
      return {
        ok: false,
        disabled: false,
        status: res.status,
        results: [],
        error: "invalid_json",
      };
    }

    const results = parseSerperOrganicPayload(data);
    if (channel && !opts.skipCache) {
      await setCachedSearch(channel, q, results);
    }

    return { ok: true, disabled: false, status: res.status, results };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(JSON.stringify({ event: "serper_search_error", query: q.slice(0, 120), error: msg }));
    return { ok: false, disabled: false, results: [], error: msg };
  }
}

/** Health check for ops — does not print the API key. */
export async function serperPing(
  testQuery = "site:sra.org.uk solicitors",
): Promise<SerperPingResult> {
  const apiKeyPresent = isSerperApiConfigured();
  if (!apiKeyPresent) {
    return { ok: false, apiKeyPresent: false, organicCount: 0, error: "serper_api_key_missing" };
  }

  const resp = await searchSerperOrganic({
    q: testQuery,
    num: 3,
    skipCache: true,
  });

  return {
    ok: resp.ok,
    apiKeyPresent: true,
    status: resp.status,
    organicCount: resp.results.length,
    error: resp.error,
  };
}
