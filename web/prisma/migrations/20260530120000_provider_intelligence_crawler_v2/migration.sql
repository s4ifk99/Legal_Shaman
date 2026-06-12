-- Provider Intelligence Crawler v2 tables

CREATE TABLE "provider_crawl_runs" (
    "id" TEXT NOT NULL,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "stage" VARCHAR(48) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'queued',
    "priority" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "stats_json" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_crawl_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_websites" (
    "id" TEXT NOT NULL,
    "crawl_run_id" TEXT,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source_type" VARCHAR(48) NOT NULL,
    "source_url" VARCHAR(2048),
    "extraction_method" VARCHAR(48) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_websites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_contacts" (
    "id" TEXT NOT NULL,
    "crawl_run_id" TEXT,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "field_name" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source_type" VARCHAR(48) NOT NULL,
    "source_url" VARCHAR(2048),
    "extraction_method" VARCHAR(48) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_practice_areas" (
    "id" TEXT NOT NULL,
    "crawl_run_id" TEXT,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "slug" VARCHAR(128),
    "label" VARCHAR(256) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source_type" VARCHAR(48) NOT NULL,
    "source_url" VARCHAR(2048),
    "extraction_method" VARCHAR(48) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_practice_areas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_review_signals" (
    "id" TEXT NOT NULL,
    "crawl_run_id" TEXT,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "signal_type" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source_type" VARCHAR(48) NOT NULL,
    "source_url" VARCHAR(2048),
    "extraction_method" VARCHAR(48) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_review_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_websites_entity_id_url_key" ON "provider_websites"("entity_id", "url");
CREATE INDEX "provider_websites_entity_id_status_idx" ON "provider_websites"("entity_id", "status");

CREATE UNIQUE INDEX "provider_contacts_entity_id_field_name_value_key" ON "provider_contacts"("entity_id", "field_name", "value");
CREATE INDEX "provider_contacts_entity_id_status_idx" ON "provider_contacts"("entity_id", "status");
CREATE INDEX "provider_contacts_field_name_idx" ON "provider_contacts"("field_name");

CREATE UNIQUE INDEX "provider_practice_areas_entity_id_label_key" ON "provider_practice_areas"("entity_id", "label");
CREATE INDEX "provider_practice_areas_entity_id_status_idx" ON "provider_practice_areas"("entity_id", "status");

CREATE UNIQUE INDEX "provider_review_signals_entity_id_signal_type_value_key" ON "provider_review_signals"("entity_id", "signal_type", "value");
CREATE INDEX "provider_review_signals_entity_id_status_idx" ON "provider_review_signals"("entity_id", "status");

CREATE INDEX "provider_crawl_runs_status_scheduled_at_idx" ON "provider_crawl_runs"("status", "scheduled_at");
CREATE INDEX "provider_crawl_runs_entity_id_stage_idx" ON "provider_crawl_runs"("entity_id", "stage");

ALTER TABLE "provider_websites" ADD CONSTRAINT "provider_websites_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "provider_crawl_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "provider_contacts" ADD CONSTRAINT "provider_contacts_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "provider_crawl_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "provider_practice_areas" ADD CONSTRAINT "provider_practice_areas_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "provider_crawl_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "provider_review_signals" ADD CONSTRAINT "provider_review_signals_crawl_run_id_fkey" FOREIGN KEY ("crawl_run_id") REFERENCES "provider_crawl_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
