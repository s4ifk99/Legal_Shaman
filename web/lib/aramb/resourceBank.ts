import type { FreeResourceCandidate } from '@/lib/coherence/researchBundle'
import { coherenceDatabaseUrl } from '@/lib/coherence/config'
import { sraQuery } from '@/lib/coherence/server/sra-db'

let tableReady: Promise<void> | null = null

async function ensureResourceBank(): Promise<void> {
  if (!coherenceDatabaseUrl()) return
  if (!tableReady) {
    tableReady = sraQuery(`
        CREATE TABLE IF NOT EXISTS coherence_resource_candidates (
          id TEXT PRIMARY KEY,
          canonical_url TEXT NOT NULL UNIQUE,
          title VARCHAR(240) NOT NULL,
          description TEXT NOT NULL,
          resource_type VARCHAR(32) NOT NULL,
          matter_type VARCHAR(32) NOT NULL,
          topic_id VARCHAR(120) NOT NULL,
          phone VARCHAR(40),
          source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          provenance VARCHAR(32) NOT NULL DEFAULT 'aramb',
          review_status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          seen_count INTEGER NOT NULL DEFAULT 1
        );
      `)
      .then(() =>
        sraQuery(`
          ALTER TABLE coherence_resource_candidates
          ADD COLUMN IF NOT EXISTS cost_band VARCHAR(8) NOT NULL DEFAULT 'free';
        `),
      )
      .then(() => undefined)
      .catch((error) => {
        tableReady = null
        throw error
      })
  }
  await tableReady
}

/**
 * Store open-web free-help discoveries as reviewable candidates.
 * They are deliberately not promoted into the trusted service index.
 */
export async function saveArambFreeResourceCandidates(
  resources: FreeResourceCandidate[],
): Promise<number> {
  if (!resources.length || !coherenceDatabaseUrl()) return 0
  try {
    await ensureResourceBank()
    for (const resource of resources) {
      await sraQuery(
        `
          INSERT INTO coherence_resource_candidates
            (id, canonical_url, title, description, resource_type, matter_type, topic_id, phone, source_ids, cost_band)
          VALUES (md5($1), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
          ON CONFLICT (canonical_url) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            phone = EXCLUDED.phone,
            source_ids = EXCLUDED.source_ids,
            resource_type = EXCLUDED.resource_type,
            cost_band = EXCLUDED.cost_band,
            last_seen_at = NOW(),
            seen_count = coherence_resource_candidates.seen_count + 1,
            review_status = CASE
              WHEN coherence_resource_candidates.review_status = 'approved' THEN 'approved'
              ELSE 'pending_review'
            END
        `,
        [
          resource.url.replace(/\/+$/, '').toLowerCase(),
          resource.title,
          resource.description,
          resource.resourceType,
          resource.matterType,
          resource.topicId,
          resource.phone || null,
          JSON.stringify(resource.sourceIds),
          resource.costBand === 'paid' ? 'paid' : 'free',
        ],
      )
    }
    return resources.length
  } catch (error) {
    console.warn('[aramb-resource-bank] save failed:', error instanceof Error ? error.message : error)
    return 0
  }
}

/** Persist Third Eye official/primary sources as wiki-library candidates (pending review). */
export async function saveWikiLibraryCandidates(
  sources: { title: string; url: string; excerpt?: string; tier?: string; origin?: string }[],
  matterSlug = 'unknown',
): Promise<number> {
  const eligible = sources.filter(
    (s) =>
      s.origin === 'external' &&
      /^https:\/\//i.test(s.url) &&
      (s.tier === 'official' || s.tier === 'primary-law' || s.tier === 'trusted-guidance'),
  )
  if (!eligible.length || !coherenceDatabaseUrl()) return 0
  try {
    await ensureResourceBank()
    for (const source of eligible) {
      await sraQuery(
        `
          INSERT INTO coherence_resource_candidates
            (id, canonical_url, title, description, resource_type, matter_type, topic_id, phone, source_ids)
          VALUES (md5($1), $1, $2, $3, 'library', $4, 'wiki-candidate', NULL, '[]'::jsonb)
          ON CONFLICT (canonical_url) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            last_seen_at = NOW(),
            seen_count = coherence_resource_candidates.seen_count + 1,
            review_status = CASE
              WHEN coherence_resource_candidates.review_status = 'approved' THEN 'approved'
              ELSE 'pending_review'
            END
        `,
        [
          source.url.replace(/\/+$/, '').toLowerCase(),
          source.title.slice(0, 240),
          (source.excerpt || source.title).slice(0, 2000),
          matterSlug.slice(0, 32),
        ],
      )
    }
    return eligible.length
  } catch (error) {
    console.warn('[wiki-library-candidates] save failed:', error instanceof Error ? error.message : error)
    return 0
  }
}

const HELP_RESOURCE_TYPES = [
  'charity',
  'helpline',
  'clinic',
  'ombudsman',
  'government',
  'directory',
  'other',
  'solicitor',
  'law-centre',
  'legal-aid',
] as const

/** Cached Third Eye Matching Help leads (not the trusted index). */
export async function listArambHelpCandidates(opts: {
  matterType?: string
  limit?: number
}): Promise<FreeResourceCandidate[]> {
  if (!coherenceDatabaseUrl()) return []
  try {
    await ensureResourceBank()
    const matter = (opts.matterType || '').trim().slice(0, 32)
    const limit = Math.min(Math.max(opts.limit ?? 12, 1), 24)
    const result = matter
      ? await sraQuery<{
          rows: Array<{
            id: string
            canonical_url: string
            title: string
            description: string
            resource_type: string
            matter_type: string
            topic_id: string
            phone: string | null
            source_ids: unknown
            cost_band: string | null
            review_status: string
          }>
        }>(
          `
          SELECT id, canonical_url, title, description, resource_type, matter_type, topic_id, phone, source_ids, cost_band, review_status
          FROM coherence_resource_candidates
          WHERE resource_type = ANY($1::text[])
            AND (matter_type = $2 OR matter_type = 'unknown')
            AND review_status IN ('pending_review', 'approved')
          ORDER BY last_seen_at DESC
          LIMIT $3
        `,
          [HELP_RESOURCE_TYPES, matter, limit],
        )
      : await sraQuery<{
          rows: Array<{
            id: string
            canonical_url: string
            title: string
            description: string
            resource_type: string
            matter_type: string
            topic_id: string
            phone: string | null
            source_ids: unknown
            cost_band: string | null
            review_status: string
          }>
        }>(
          `
          SELECT id, canonical_url, title, description, resource_type, matter_type, topic_id, phone, source_ids, cost_band, review_status
          FROM coherence_resource_candidates
          WHERE resource_type = ANY($1::text[])
            AND review_status IN ('pending_review', 'approved')
          ORDER BY last_seen_at DESC
          LIMIT $2
        `,
          [HELP_RESOURCE_TYPES, limit],
        )
    return (result.rows || []).map((row) => {
      const sourceIds = Array.isArray(row.source_ids)
        ? row.source_ids.map((id) => String(id))
        : []
      return {
        id: String(row.id).slice(0, 120),
        title: row.title,
        description: row.description,
        url: row.canonical_url,
        resourceType: row.resource_type as FreeResourceCandidate['resourceType'],
        costBand: row.cost_band === 'paid' ? 'paid' : 'free',
        matterType: row.matter_type as FreeResourceCandidate['matterType'],
        topicId: row.topic_id,
        phone: row.phone || undefined,
        sourceIds,
        reviewStatus: 'pending_review' as const,
      }
    })
  } catch (error) {
    console.warn('[aramb-resource-bank] list help failed:', error instanceof Error ? error.message : error)
    return []
  }
}
