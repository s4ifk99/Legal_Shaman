import {
  extractPublishedFeeFromText,
  isHttpsUrl,
} from "@/lib/legal-search/evidence/fee-page-extract";
import {
  lookupPublishedPriceFromStore,
  upsertPublishedPrice,
} from "@/lib/legal-search/evidence/published-price-store";
import { isAcceptablePublishedPrice as validatePublishedPrice } from "@/lib/legal-search/evidence/published-price-validate";
import type { PublishedPriceRecord } from "@/lib/legal-search/evidence/types";
import { websiteHost } from "@/lib/legal-search/evidence/identity-match";

export type FeeHarvestTarget = {
  resultId: string;
  providerName: string;
  website: string;
  /** Optional matter hint for service labelling. */
  serviceHint?: string;
};

export type FeeHarvestResult = {
  resultId: string;
  status: "stored" | "skipped_existing" | "no_page" | "extract_failed" | "invalid" | "error";
  sourceUrl?: string;
  error?: string;
  record?: PublishedPriceRecord;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function sameHost(pageUrl: string, firmWebsite: string): boolean {
  const pageHost = websiteHost(pageUrl);
  const firmHost = websiteHost(firmWebsite);
  if (!pageHost || !firmHost) return false;
  return pageHost === firmHost || pageHost.endsWith(`.${firmHost}`) || firmHost.endsWith(`.${pageHost}`);
}

async function searchFeePagesWithExa(input: {
  providerName: string;
  website: string;
}): Promise<Array<{ url: string; title: string; text: string }>> {
  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) return [];
  if (process.env.PROVIDER_CRAWL_SKIP_FETCH === "1") return [];

  const host = websiteHost(input.website);
  const query = [
    `"${input.providerName}"`,
    "price transparency OR legal costs OR fees OR pricing",
    "solicitors",
    host ? `site:${host}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body: Record<string, unknown> = {
    query: query.slice(0, 2000),
    type: "auto",
    numResults: 5,
    userLocation: "GB",
    contents: {
      text: { maxCharacters: 8000 },
      highlights: { numSentences: 6 },
    },
  };
  if (host) {
    body.includeDomains = [host];
  }

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`exa_search_${res.status}`);
  }
  const data = (await res.json()) as {
    results?: Array<{
      url?: string;
      title?: string;
      text?: string;
      highlights?: string[];
    }>;
  };
  const out: Array<{ url: string; title: string; text: string }> = [];
  for (const row of data.results ?? []) {
    const url = String(row.url || "").trim();
    if (!url || !isHttpsUrl(url)) continue;
    if (host && !sameHost(url, input.website)) continue;
    const highlights = Array.isArray(row.highlights)
      ? row.highlights.map((h) => String(h || "").trim()).filter(Boolean).join(" ")
      : "";
    const text = `${row.title || ""}\n${highlights}\n${row.text || ""}`.trim();
    if (!text) continue;
    out.push({
      url,
      title: String(row.title || "").trim() || url,
      text,
    });
  }
  return out;
}

/**
 * Offline harvest: find a firm's transparency/fees page via Exa, extract GBP range, persist.
 * Never invents fees. Search attach path only reads stored acceptable records.
 */
export async function harvestPublishedFeeForFirm(
  target: FeeHarvestTarget,
  opts?: { force?: boolean; storePath?: string },
): Promise<FeeHarvestResult> {
  try {
    if (!opts?.force) {
      const existing = lookupPublishedPriceFromStore(target.resultId, opts?.storePath);
      if (existing) {
        return { resultId: target.resultId, status: "skipped_existing", record: existing, sourceUrl: existing.sourceUrl };
      }
    }

    const pages = await searchFeePagesWithExa({
      providerName: target.providerName,
      website: target.website,
    });
    if (!pages.length) {
      return { resultId: target.resultId, status: "no_page" };
    }

    for (const page of pages) {
      const extracted = extractPublishedFeeFromText(page.text, {
        defaultService: target.serviceHint,
      });
      if (!extracted) continue;
      const record: PublishedPriceRecord = {
        resultId: target.resultId,
        providerName: target.providerName.trim(),
        service: extracted.service,
        minPence: extracted.minPence,
        maxPence: extracted.maxPence,
        currency: "GBP",
        sourceUrl: page.url,
        checkedOn: todayIso(),
      };
      if (!validatePublishedPrice(record)) {
        return { resultId: target.resultId, status: "invalid", sourceUrl: page.url };
      }
      const ok = upsertPublishedPrice(record, opts?.storePath);
      if (!ok) {
        return { resultId: target.resultId, status: "invalid", sourceUrl: page.url };
      }
      return { resultId: target.resultId, status: "stored", sourceUrl: page.url, record };
    }

    return { resultId: target.resultId, status: "extract_failed", sourceUrl: pages[0]?.url };
  } catch (error) {
    return {
      resultId: target.resultId,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function harvestPublishedFeesBatch(
  targets: FeeHarvestTarget[],
  opts?: { force?: boolean; storePath?: string; delayMs?: number },
): Promise<FeeHarvestResult[]> {
  const results: FeeHarvestResult[] = [];
  const delay = opts?.delayMs ?? 400;
  for (const target of targets) {
    results.push(await harvestPublishedFeeForFirm(target, opts));
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return results;
}
