import { createHash } from 'node:crypto'

import type { ResearchBundle } from '@/lib/coherence/researchBundle'
import { coherenceDatabaseUrl } from '@/lib/coherence/config'
import { sraQuery } from '@/lib/coherence/server/sra-db'

const DEFAULT_TTL_DAYS = 14
const MEMORY_MAX_ENTRIES = 64

let tableReady: Promise<void> | null = null

export function penumbraCacheEnabled(): boolean {
  const raw = process.env.PENUMBRA_CACHE_ENABLED?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return true
}

export function penumbraCacheVersion(): string {
  return process.env.PENUMBRA_CACHE_VERSION?.trim() || '2-full'
}

function cacheTtlDays(): number {
  const parsed = Number(process.env.PENUMBRA_CACHE_TTL_DAYS || DEFAULT_TTL_DAYS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_DAYS
}

/** Stable normalisation for cross-user cache keys (no tenant id). */
export function normalizePenumbraCacheQuery(query: string): string {
  return query
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 4000)
}

export function buildPenumbraCacheKey(query: string, matterSlug?: string): string {
  const matter = (matterSlug || 'unknown').trim().toLowerCase().slice(0, 80)
  const payload = `${penumbraCacheVersion()}|${matter}|${normalizePenumbraCacheQuery(query)}`
  return createHash('sha256').update(payload).digest('hex')
}

function isCacheableBundle(bundle: ResearchBundle): boolean {
  if (bundle.status !== 'complete') return false
  return bundle.sources.length > 0 || bundle.claims.length > 0
}

type MemoryEntry = { bundle: ResearchBundle; expiresAt: number }
const memoryCache = new Map<string, MemoryEntry>()

function trimMemoryCache(): void {
  if (memoryCache.size <= MEMORY_MAX_ENTRIES) return
  const sorted = [...memoryCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
  while (memoryCache.size > MEMORY_MAX_ENTRIES && sorted.length) {
    const [key] = sorted.shift()!
    memoryCache.delete(key)
  }
}

async function ensureCacheTable(): Promise<void> {
  if (!coherenceDatabaseUrl()) return
  if (!tableReady) {
    tableReady = sraQuery(`
        CREATE TABLE IF NOT EXISTS penumbra_research_cache (
          cache_key CHAR(64) PRIMARY KEY,
          cache_version VARCHAR(16) NOT NULL DEFAULT '1',
          matter_slug VARCHAR(80) NOT NULL DEFAULT 'unknown',
          query_norm TEXT NOT NULL,
          bundle_json JSONB NOT NULL,
          source_count INTEGER NOT NULL DEFAULT 0,
          hit_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS penumbra_research_cache_expires_idx
          ON penumbra_research_cache (expires_at);
        CREATE INDEX IF NOT EXISTS penumbra_research_cache_matter_idx
          ON penumbra_research_cache (matter_slug, created_at DESC);
      `)
      .then(() => undefined)
      .catch((error) => {
        tableReady = null
        throw error
      })
  }
  await tableReady
}

function readBundleJson(value: unknown): ResearchBundle | null {
  if (!value || typeof value !== 'object') return null
  const bundle = value as ResearchBundle
  if (!bundle.mode || !Array.isArray(bundle.sources)) return null
  return bundle
}

export function buildExaHitsCacheKey(queryPlan: string, matterSlug?: string): string {
  return buildPenumbraCacheKey(`exa-hits|${queryPlan}`, matterSlug)
}

type HitsPayload = { hits: Array<{ id: string; url: string; title: string; excerpt: string; publishedDate?: string }> }

function readHitsPayload(value: unknown): HitsPayload | null {
  if (!value || typeof value !== 'object') return null
  const hits = (value as HitsPayload).hits
  if (!Array.isArray(hits)) return null
  return { hits }
}

export async function getPenumbraExaHitsCache(cacheKey: string): Promise<HitsPayload | null> {
  if (!penumbraCacheEnabled()) return null
  const mem = memoryCache.get(cacheKey)
  if (mem?.expiresAt > Date.now()) {
    const payload = readHitsPayload(mem.bundle as unknown as HitsPayload)
    if (payload?.hits.length) return payload
  }
  if (!coherenceDatabaseUrl()) return null
  try {
    await ensureCacheTable()
    const res = await sraQuery<{ rows: Array<{ bundle_json: unknown }> }>(
      `SELECT bundle_json FROM penumbra_research_cache WHERE cache_key = $1 AND expires_at > NOW() LIMIT 1`,
      [cacheKey],
    )
    const payload = readHitsPayload(res.rows[0]?.bundle_json)
    if (!payload?.hits.length) return null
    const expiresAt = Date.now() + cacheTtlDays() * 86_400_000
    memoryCache.set(cacheKey, { bundle: payload as unknown as ResearchBundle, expiresAt })
    return payload
  } catch (error) {
    console.warn('[penumbra-cache] hits get failed:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function putPenumbraExaHitsCache(opts: {
  cacheKey: string
  query: string
  matterSlug?: string
  hits: HitsPayload['hits']
}): Promise<void> {
  if (!penumbraCacheEnabled() || !opts.hits.length) return
  const payload = { hits: opts.hits } as unknown as ResearchBundle
  const expiresAt = Date.now() + cacheTtlDays() * 86_400_000
  memoryCache.set(opts.cacheKey, { bundle: payload, expiresAt })
  trimMemoryCache()
  if (!coherenceDatabaseUrl()) return
  try {
    await ensureCacheTable()
    await sraQuery(
      `
        INSERT INTO penumbra_research_cache (
          cache_key, cache_version, matter_slug, query_norm, bundle_json, source_count, expires_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW() + ($7::text || ' days')::interval)
        ON CONFLICT (cache_key) DO UPDATE SET
          bundle_json = EXCLUDED.bundle_json,
          source_count = EXCLUDED.source_count,
          cache_version = EXCLUDED.cache_version,
          expires_at = EXCLUDED.expires_at,
          last_hit_at = NOW()
      `,
      [
        opts.cacheKey,
        penumbraCacheVersion(),
        (opts.matterSlug || 'unknown').slice(0, 80),
        normalizePenumbraCacheQuery(opts.query).slice(0, 2000),
        JSON.stringify({ hits: opts.hits }),
        opts.hits.length,
        String(cacheTtlDays()),
      ],
    )
  } catch (error) {
    console.warn('[penumbra-cache] hits put failed:', error instanceof Error ? error.message : error)
  }
}

export type PenumbraCacheHit = {
  bundle: ResearchBundle
  cacheKey: string
  hitCount: number
}

export async function getPenumbraResearchCache(cacheKey: string): Promise<PenumbraCacheHit | null> {
  if (!penumbraCacheEnabled()) return null

  const mem = memoryCache.get(cacheKey)
  if (mem) {
    if (mem.expiresAt > Date.now() && isCacheableBundle(mem.bundle)) {
      return { bundle: mem.bundle, cacheKey, hitCount: 0 }
    }
    memoryCache.delete(cacheKey)
  }

  if (!coherenceDatabaseUrl()) return null

  try {
    await ensureCacheTable()
    const res = await sraQuery<{
      rows: Array<{ bundle_json: unknown; hit_count: number }>
    }>(
      `
        SELECT bundle_json, hit_count
        FROM penumbra_research_cache
        WHERE cache_key = $1 AND expires_at > NOW()
        LIMIT 1
      `,
      [cacheKey],
    )
    const row = res.rows[0]
    if (!row) return null
    const bundle = readBundleJson(row.bundle_json)
    if (!bundle || !isCacheableBundle(bundle)) return null

    void sraQuery(
      `
        UPDATE penumbra_research_cache
        SET hit_count = hit_count + 1, last_hit_at = NOW()
        WHERE cache_key = $1
      `,
      [cacheKey],
    ).catch(() => {})

    const expiresAt = Date.now() + cacheTtlDays() * 86_400_000
    memoryCache.set(cacheKey, { bundle, expiresAt })
    trimMemoryCache()

    return { bundle, cacheKey, hitCount: Number(row.hit_count || 0) + 1 }
  } catch (error) {
    console.warn(
      '[penumbra-cache] get failed:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

export async function putPenumbraResearchCache(opts: {
  cacheKey: string
  query: string
  matterSlug?: string
  bundle: ResearchBundle
}): Promise<void> {
  if (!penumbraCacheEnabled() || !isCacheableBundle(opts.bundle)) return

  const expiresAt = Date.now() + cacheTtlDays() * 86_400_000
  memoryCache.set(opts.cacheKey, { bundle: opts.bundle, expiresAt })
  trimMemoryCache()

  if (!coherenceDatabaseUrl()) return

  try {
    await ensureCacheTable()
    const queryNorm = normalizePenumbraCacheQuery(opts.query).slice(0, 2000)
    const matterSlug = (opts.matterSlug || 'unknown').slice(0, 80)
    await sraQuery(
      `
        INSERT INTO penumbra_research_cache (
          cache_key,
          cache_version,
          matter_slug,
          query_norm,
          bundle_json,
          source_count,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW() + ($7::text || ' days')::interval)
        ON CONFLICT (cache_key) DO UPDATE SET
          bundle_json = EXCLUDED.bundle_json,
          source_count = EXCLUDED.source_count,
          cache_version = EXCLUDED.cache_version,
          expires_at = EXCLUDED.expires_at,
          last_hit_at = NOW()
      `,
      [
        opts.cacheKey,
        penumbraCacheVersion(),
        matterSlug,
        queryNorm,
        JSON.stringify(opts.bundle),
        opts.bundle.sources.length,
        String(cacheTtlDays()),
      ],
    )
  } catch (error) {
    console.warn(
      '[penumbra-cache] put failed:',
      error instanceof Error ? error.message : error,
    )
  }
}

/** Test helper */
export function clearPenumbraResearchMemoryCacheForTests(): void {
  memoryCache.clear()
}
