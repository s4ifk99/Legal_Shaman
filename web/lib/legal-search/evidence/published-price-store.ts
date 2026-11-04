import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { isAcceptablePublishedPrice } from "@/lib/legal-search/evidence/published-price-validate";
import type { PublishedPriceRecord } from "@/lib/legal-search/evidence/types";

/** Default path when the app / scripts run with cwd = Signpost/web. */
const DEFAULT_STORE = join(
  process.cwd(),
  "lib",
  "legal-search",
  "evidence",
  "data",
  "published-prices.json",
);

function resolveStorePath(override?: string): string {
  if (override?.trim()) return override.trim();
  if (process.env.PUBLISHED_PRICES_PATH?.trim()) {
    return process.env.PUBLISHED_PRICES_PATH.trim();
  }
  return DEFAULT_STORE;
}

function parseStore(raw: string): PublishedPriceRecord[] {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((row): row is PublishedPriceRecord => isAcceptablePublishedPrice(row));
  } catch {
    return [];
  }
}

let memoryCache: PublishedPriceRecord[] | null = null;
let memoryPath: string | null = null;

/** Load durable published prices (JSON seed / harvest output). */
export function loadPublishedPriceStore(pathOverride?: string): PublishedPriceRecord[] {
  const path = resolveStorePath(pathOverride);
  if (memoryCache && memoryPath === path) return memoryCache;
  if (!existsSync(path)) {
    memoryCache = [];
    memoryPath = path;
    return memoryCache;
  }
  memoryCache = parseStore(readFileSync(path, "utf8"));
  memoryPath = path;
  return memoryCache;
}

export function lookupPublishedPriceFromStore(
  resultId: string,
  pathOverride?: string,
): PublishedPriceRecord | null {
  const found = loadPublishedPriceStore(pathOverride).find((row) => row.resultId === resultId);
  return found && isAcceptablePublishedPrice(found) ? found : null;
}

/**
 * Upsert one published price by resultId. Keeps other rows. Returns false if record invalid.
 */
export function upsertPublishedPrice(
  record: PublishedPriceRecord,
  pathOverride?: string,
): boolean {
  if (!isAcceptablePublishedPrice(record)) return false;
  const path = resolveStorePath(pathOverride);
  const existing = loadPublishedPriceStore(path).filter((row) => row.resultId !== record.resultId);
  const next = [...existing, record];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  memoryCache = next;
  memoryPath = path;
  return true;
}

export function publishedPriceStorePath(pathOverride?: string): string {
  return resolveStorePath(pathOverride);
}

/** Test helper — clear in-process cache after writing fixtures. */
export function clearPublishedPriceStoreCache(): void {
  memoryCache = null;
  memoryPath = null;
}
