-- Cached Third Eye / Penumbra research bundles (Exa + LLM output).
-- Shared across users for identical matter + normalised query; bump PENUMBRA_CACHE_VERSION to invalidate.
CREATE TABLE IF NOT EXISTS "penumbra_research_cache" (
  "cache_key" CHAR(64) PRIMARY KEY,
  "cache_version" VARCHAR(16) NOT NULL DEFAULT '1',
  "matter_slug" VARCHAR(80) NOT NULL DEFAULT 'unknown',
  "query_norm" TEXT NOT NULL,
  "bundle_json" JSONB NOT NULL,
  "source_count" INTEGER NOT NULL DEFAULT 0,
  "hit_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_hit_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "penumbra_research_cache_expires_idx"
  ON "penumbra_research_cache" ("expires_at");

CREATE INDEX IF NOT EXISTS "penumbra_research_cache_matter_idx"
  ON "penumbra_research_cache" ("matter_slug", "created_at" DESC);
