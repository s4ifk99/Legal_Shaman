/**
 * Disk-backed who-helps freeHelp cache (Node / scripts / server only).
 * Do not import from client components — use whoHelpsFreeHelpCache.ts stub there.
 */
import fs from "node:fs";
import path from "node:path";
import type { FreeServiceHit } from "@/lib/coherence/matchFreeServices";
import { normalizeWhoHelpsQuery } from "@/lib/coherence/normalizeWhoHelpsQuery";

export type WhoHelpsFreeHelpCacheEntry = {
  queryKeys: string[];
  title: string;
  wikiId: string;
  liveUrl: string;
  freeHelp: FreeServiceHit[];
  publishedAt: string;
  /** "draft" = warmed by blog:match-free (strong matches only); "published" = wiki promote. */
  stage?: "draft" | "published";
};

type CacheIndex = {
  updatedAt: string;
  byKey: Record<string, string>;
};

const CACHE_DIR = path.join(process.cwd(), "data", "coherence", "who-helps-freehelp-cache");
const INDEX_PATH = path.join(CACHE_DIR, "index.json");

function slugFromTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "who-helps"
  );
}

function readIndex(): CacheIndex {
  if (!fs.existsSync(INDEX_PATH)) return { updatedAt: "", byKey: {} };
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as CacheIndex;
  } catch {
    return { updatedAt: "", byKey: {} };
  }
}

function writeIndex(index: CacheIndex) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    INDEX_PATH,
    `${JSON.stringify({ ...index, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

export function writeWhoHelpsFreeHelpCache(entry: WhoHelpsFreeHelpCacheEntry): string {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const slug = slugFromTitle(entry.title);
  const filePath = path.join(CACHE_DIR, `${slug}.json`);
  let toWrite: WhoHelpsFreeHelpCacheEntry = entry;
  if (fs.existsSync(filePath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(filePath, "utf8")) as WhoHelpsFreeHelpCacheEntry;
      const queryKeys = [...new Set([...(prev.queryKeys ?? []), ...entry.queryKeys])];
      // A draft-time warm must never clobber a published entry (wikiId / liveUrl).
      const keepPrev = entry.stage === "draft" && Boolean(prev.wikiId);
      toWrite = keepPrev ? { ...prev, queryKeys } : { ...entry, queryKeys };
    } catch {
      /* unreadable entry: overwrite */
    }
  }
  fs.writeFileSync(filePath, `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");

  const index = readIndex();
  for (const key of toWrite.queryKeys) {
    const n = normalizeWhoHelpsQuery(key);
    if (n) index.byKey[n] = slug;
  }
  writeIndex(index);
  return filePath;
}

export function lookupWhoHelpsFreeHelpCache(query: string): WhoHelpsFreeHelpCacheEntry | null {
  const key = normalizeWhoHelpsQuery(query);
  if (!key) return null;
  const index = readIndex();
  let slug = index.byKey[key];
  if (!slug) {
    for (const [k, s] of Object.entries(index.byKey)) {
      if (k.length < 12) continue;
      if (key.includes(k) || k.includes(key)) {
        slug = s;
        break;
      }
    }
  }
  if (!slug) return null;
  const filePath = path.join(CACHE_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as WhoHelpsFreeHelpCacheEntry;
  } catch {
    return null;
  }
}
