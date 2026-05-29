-- Incremental indexing queue + search index build audit.
CREATE TABLE IF NOT EXISTS "indexing_jobs" (
    "id" TEXT NOT NULL,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_source" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "reason" VARCHAR(255),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "indexing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "indexing_jobs_status_created_at_idx" ON "indexing_jobs"("status", "created_at");
CREATE INDEX IF NOT EXISTS "indexing_jobs_entity_id_entity_source_idx" ON "indexing_jobs"("entity_id", "entity_source");

CREATE TABLE IF NOT EXISTS "search_index_builds" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "environment" VARCHAR(64) NOT NULL,
    "database_host" VARCHAR(255),
    "typesense_host" VARCHAR(255),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'running',
    "document_count" INTEGER,
    "sra_count" INTEGER,
    "legal_aid_count" INTEGER,
    "pro_bono_count" INTEGER,
    "errors_json" TEXT,

    CONSTRAINT "search_index_builds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "search_index_builds_source_started_at_idx" ON "search_index_builds"("source", "started_at");
CREATE INDEX IF NOT EXISTS "search_index_builds_status_started_at_idx" ON "search_index_builds"("status", "started_at");
