-- Open-web free-help discoveries from Aramb.
-- Candidates remain pending_review until a human approves them for the
-- trusted freeServicesIndex.
CREATE TABLE IF NOT EXISTS "coherence_resource_candidates" (
  "id" TEXT PRIMARY KEY,
  "canonical_url" TEXT NOT NULL UNIQUE,
  "title" VARCHAR(240) NOT NULL,
  "description" TEXT NOT NULL,
  "resource_type" VARCHAR(32) NOT NULL,
  "matter_type" VARCHAR(32) NOT NULL,
  "topic_id" VARCHAR(120) NOT NULL,
  "phone" VARCHAR(40),
  "source_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "provenance" VARCHAR(32) NOT NULL DEFAULT 'aramb',
  "review_status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
  "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "seen_count" INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS "coherence_resource_candidates_review_status_idx"
  ON "coherence_resource_candidates" ("review_status", "matter_type", "topic_id");
