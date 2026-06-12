-- SRA v2 sync: structured register fields + raw payload for forward-compatible re-mapping
ALTER TABLE "sra_organisations"
  ADD COLUMN IF NOT EXISTS "website" VARCHAR(2048) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "email" VARCHAR(512) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "trading_names" JSONB,
  ADD COLUMN IF NOT EXISTS "previous_names" JSONB,
  ADD COLUMN IF NOT EXISTS "work_area" JSONB,
  ADD COLUMN IF NOT EXISTS "authorisation_status" VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "offices" JSONB,
  ADD COLUMN IF NOT EXISTS "raw_payload" JSONB;
