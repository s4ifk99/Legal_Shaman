-- Archive table for SRA organisations removed from the live register (not in latest GetAll).
CREATE TABLE "sra_organisations_archive" (
    "id" TEXT NOT NULL,
    "sra_id" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" VARCHAR(64) NOT NULL DEFAULT 'not_in_getall',
    "archived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sra_organisations_archive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sra_organisations_archive_sra_id_idx" ON "sra_organisations_archive"("sra_id");
CREATE INDEX "sra_organisations_archive_archived_at_idx" ON "sra_organisations_archive"("archived_at");
