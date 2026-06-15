-- Provenance for names recovered from the SRA Register (lookup by organisation number).
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "name_recovery_source" VARCHAR(32);
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "name_recovery_source_url" VARCHAR(2048);
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "name_recovery_fetched_at" TIMESTAMPTZ(3);
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "name_recovery_confidence" DOUBLE PRECISION;
