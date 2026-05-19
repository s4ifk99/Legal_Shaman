-- SearchInteraction: unified legal search observability
ALTER TABLE "search_interactions"
  ADD COLUMN IF NOT EXISTS "channel" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "latency_ms" INTEGER,
  ADD COLUMN IF NOT EXISTS "degraded_modes" JSONB,
  ADD COLUMN IF NOT EXISTS "result_count" INTEGER,
  ADD COLUMN IF NOT EXISTS "parsed_query" JSONB,
  ADD COLUMN IF NOT EXISTS "unified_result_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
