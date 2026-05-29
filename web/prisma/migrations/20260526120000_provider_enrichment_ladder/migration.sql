-- CreateTable
CREATE TABLE "provider_enrichment_states" (
    "entity_id" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'not_started',
    "priority_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discovered_website" VARCHAR(2048),
    "last_error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_enrichment_states_pkey" PRIMARY KEY ("entity_id")
);

-- CreateIndex
CREATE INDEX "provider_enrichment_states_status_priority_score_idx" ON "provider_enrichment_states"("status", "priority_score");
