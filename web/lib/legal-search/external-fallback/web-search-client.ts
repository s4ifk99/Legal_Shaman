import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildFallbackSearchContext,
  selectFallbackSources,
  shouldTriggerExternalFallback,
} from "@/lib/legal-search/external-fallback/fallback-router";
import { normaliseTrustedSourceHit } from "@/lib/legal-search/external-fallback/result-normaliser";
import type { TrustedSourceDefinition } from "@/lib/legal-search/external-fallback/trusted-sources";
import { verifyExternalFallbackBatch } from "@/lib/legal-search/external-fallback/verification";
import type {
  ExternalFallbackPayload,
  ExternalFallbackReason,
  FallbackSearchContext,
  FallbackTriggerInput,
} from "@/lib/legal-search/external-fallback/types";
import {
  EXTERNAL_FALLBACK_NOTICE,
} from "@/lib/legal-search/external-fallback/types";

const CACHE_DIR = path.join(process.cwd(), ".cache/external-fallback");
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const RATE_LIMIT_MS = 250;

type CacheEntry = {
  expiresAt: number;
  payload: ExternalFallbackPayload;
};

const memoryCache = new Map<string, CacheEntry>();
let lastFetchAt = 0;

function cacheKey(ctx: FallbackSearchContext, reasons: ExternalFallbackReason[]): string {
  return [
    ctx.mergedQuery.toLowerCase().slice(0, 120),
    ctx.fundingPreference,
    ctx.fundingRoutes.join(","),
    ctx.sraAvailable ? "sra1" : "sra0",
    reasons.sort().join("|"),
  ].join("::");
}

async function readDiskCache(key: string): Promise<CacheEntry | null> {
  try {
    const file = path.join(CACHE_DIR, `${Buffer.from(key).toString("base64url")}.json`);
    const raw = await readFile(file, "utf8");
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.expiresAt < Date.now()) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeDiskCache(key: string, entry: CacheEntry): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${Buffer.from(key).toString("base64url")}.json`);
    await writeFile(file, JSON.stringify(entry), "utf8");
  } catch {
    /* cache optional */
  }
}

/** Light reachability check — HEAD only, rate-limited; never blocks signposting. */
async function verifyUrlReachable(url: string): Promise<boolean> {
  if (process.env.EXTERNAL_FALLBACK_SKIP_HEAD === "1") return true;
  const now = Date.now();
  if (now - lastFetchAt < RATE_LIMIT_MS) return true;
  lastFetchAt = now;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "LegalShamanSignpost/1.0 (fallback-link-check)" },
    });
    clearTimeout(t);
    return res.ok || res.status === 405 || res.status === 403;
  } catch {
    return true;
  }
}

async function buildResultsFromSources(
  sources: TrustedSourceDefinition[],
  ctx: FallbackSearchContext,
): Promise<{ results: ExternalFallbackPayload["results"]; sourcesQueried: string[] }> {
  const sourcesQueried: string[] = [];
  const raw: ExternalFallbackPayload["results"] = [];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]!;
    sourcesQueried.push(src.id);
    const hit = normaliseTrustedSourceHit(src, ctx, i);

    if (src.robotsRespected) {
      const ok = await verifyUrlReachable(hit.url);
      if (!ok) {
        hit.verificationNotes.push("url_check_failed_using_official_landing");
        hit.url = src.officialUrl;
        hit.confidence = Math.min(hit.confidence, 0.7);
      }
    }

    raw.push(hit);
  }

  const { results, warnings } = verifyExternalFallbackBatch(raw);
  for (const w of warnings) {
    /* surfaced in payload.debug */
  }

  return { results, sourcesQueried };
}

export async function runExternalFallback(
  input: FallbackTriggerInput,
): Promise<ExternalFallbackPayload> {
  const { trigger, reasons } = shouldTriggerExternalFallback(input);

  const emptyPayload = (): ExternalFallbackPayload => ({
    triggered: false,
    reasons: [],
    results: [],
    notice: "",
    debug: {
      fallbackTriggered: false,
      fallbackReason: "",
      fallbackSourcesQueried: [],
      externalResultsCount: 0,
      verificationWarnings: [],
    },
  });

  if (!trigger) return emptyPayload();

  const ctx = buildFallbackSearchContext(input);
  const key = cacheKey(ctx, reasons);

  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.payload;

  const disk = await readDiskCache(key);
  if (disk) {
    memoryCache.set(key, disk);
    return disk.payload;
  }

  const sources = selectFallbackSources(ctx, reasons);
  const { results, sourcesQueried } = await buildResultsFromSources(sources, ctx);
  const { warnings } = verifyExternalFallbackBatch(results);

  const payload: ExternalFallbackPayload = {
    triggered: true,
    reasons,
    results,
    notice: EXTERNAL_FALLBACK_NOTICE,
    debug: {
      fallbackTriggered: true,
      fallbackReason: reasons.join(", "),
      fallbackSourcesQueried: sourcesQueried,
      externalResultsCount: results.length,
      verificationWarnings: warnings,
    },
  };

  const entry: CacheEntry = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
  memoryCache.set(key, entry);
  await writeDiskCache(key, entry);

  return payload;
}
