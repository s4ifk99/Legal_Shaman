-- CreateTable
CREATE TABLE "provider_crawl_jobs" (
    "id" TEXT NOT NULL,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "mode" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'queued',
    "target_url" VARCHAR(2048),
    "error" TEXT,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_crawl_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_crawl_results" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "entity_id" VARCHAR(128) NOT NULL,
    "pages_fetched" INTEGER NOT NULL DEFAULT 0,
    "pages_skipped" INTEGER NOT NULL DEFAULT 0,
    "fields_found" INTEGER NOT NULL DEFAULT 0,
    "stats_json" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_crawl_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_extracted_fields" (
    "id" TEXT NOT NULL,
    "crawl_result_id" TEXT,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "field_name" VARCHAR(64) NOT NULL,
    "extracted_value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source_url" VARCHAR(2048),
    "source_type" VARCHAR(48) NOT NULL,
    "extraction_method" VARCHAR(48) NOT NULL,
    "review_category" VARCHAR(32) NOT NULL DEFAULT 'field',
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    "provenance_note" TEXT,
    "extracted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_extracted_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_crawl_jobs_status_scheduled_at_idx" ON "provider_crawl_jobs"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "provider_crawl_jobs_entity_id_idx" ON "provider_crawl_jobs"("entity_id");

-- CreateIndex
CREATE INDEX "provider_crawl_results_job_id_idx" ON "provider_crawl_results"("job_id");

-- CreateIndex
CREATE INDEX "provider_crawl_results_entity_id_idx" ON "provider_crawl_results"("entity_id");

-- CreateIndex
CREATE INDEX "provider_extracted_fields_status_review_category_created_at_idx" ON "provider_extracted_fields"("status", "review_category", "created_at");

-- CreateIndex
CREATE INDEX "provider_extracted_fields_entity_id_idx" ON "provider_extracted_fields"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_extracted_fields_entity_id_field_name_extracted_value_review_category_key" ON "provider_extracted_fields"("entity_id", "field_name", "extracted_value", "review_category");

-- AddForeignKey
ALTER TABLE "provider_crawl_results" ADD CONSTRAINT "provider_crawl_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "provider_crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_extracted_fields" ADD CONSTRAINT "provider_extracted_fields_crawl_result_id_fkey" FOREIGN KEY ("crawl_result_id") REFERENCES "provider_crawl_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;
