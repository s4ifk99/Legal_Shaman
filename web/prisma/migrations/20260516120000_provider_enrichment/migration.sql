-- CreateTable
CREATE TABLE "provider_enrichments" (
    "id" TEXT NOT NULL,
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "field_name" VARCHAR(64) NOT NULL,
    "extracted_value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source_url" VARCHAR(2048),
    "source_type" VARCHAR(48) NOT NULL,
    "extraction_method" VARCHAR(48) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    "provenance_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_enrichments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_enrichments_status_created_at_idx" ON "provider_enrichments"("status", "created_at");

-- CreateIndex
CREATE INDEX "provider_enrichments_entity_id_idx" ON "provider_enrichments"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_enrichments_entity_id_field_name_extracted_value_key" ON "provider_enrichments"("entity_id", "field_name", "extracted_value");
