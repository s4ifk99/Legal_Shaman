-- CreateTable
CREATE TABLE "sra_identity_candidates" (
    "id" TEXT NOT NULL,
    "sra_id" VARCHAR(64) NOT NULL,
    "organisation_id" VARCHAR(128) NOT NULL,
    "candidate_name" VARCHAR(512) NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "source_url" VARCHAR(2048) NOT NULL,
    "evidence_text" TEXT NOT NULL,
    "candidate_phone" VARCHAR(64) NOT NULL DEFAULT '',
    "candidate_address" TEXT NOT NULL DEFAULT '',
    "candidate_website" VARCHAR(2048) NOT NULL DEFAULT '',
    "matched_postcode" VARCHAR(32) NOT NULL DEFAULT '',
    "matched_town" VARCHAR(255) NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    "reject_reason" VARCHAR(128) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sra_identity_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sra_identity_candidates_sra_source_unique" ON "sra_identity_candidates"("sra_id", "source_type", "source_url");

-- CreateIndex
CREATE INDEX "sra_identity_candidates_status_confidence_idx" ON "sra_identity_candidates"("status", "confidence");

-- CreateIndex
CREATE INDEX "sra_identity_candidates_sra_id_idx" ON "sra_identity_candidates"("sra_id");

-- AddForeignKey
ALTER TABLE "sra_identity_candidates" ADD CONSTRAINT "sra_identity_candidates_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "sra_organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
