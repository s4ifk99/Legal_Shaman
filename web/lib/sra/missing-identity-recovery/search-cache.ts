import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const CACHE_DIR = path.join(process.cwd(), ".cache/sra-identity-search");

function cacheKey(channel: string, query: string): string {
  return createHash("sha256").update(`${channel}:${query}`).digest("hex").slice(0, 24);
}

export async function getCachedSearch<T>(channel: string, query: string): Promise<T | null> {
  try {
    const file = path.join(CACHE_DIR, `${channel}-${cacheKey(channel, query)}.json`);
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCachedSearch<T>(channel: string, query: string, data: T): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${channel}-${cacheKey(channel, query)}.json`);
  await writeFile(file, JSON.stringify(data), "utf8");
}

let lastFetchAt = 0;

export async function rateLimitSearch(ms?: number): Promise<void> {
  const delay = ms ?? Number(process.env.SRA_IDENTITY_SEARCH_DELAY_MS ?? "1200");
  const wait = delay - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}
