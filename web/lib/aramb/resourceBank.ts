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
            (id, canonical_url, title, description, resource_type, matter_type, topic_id, phone, source_ids)
          VALUES (md5($1), $1, $2, $3, $4, $5, $6, $7, $8::jsonb)
          ON CONFLICT (canonical_url) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            phone = EXCLUDED.phone,
            source_ids = EXCLUDED.source_ids,
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
        ],
      )
    }
    return resources.length
  } catch (error) {
    console.warn('[aramb-resource-bank] save failed:', error instanceof Error ? error.message : error)
    return 0
  }
}
