-- SRA firm display names (separate from legacy business_name placeholders)
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "organisation_name" VARCHAR(512) NOT NULL DEFAULT '';
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "display_name" VARCHAR(512) NOT NULL DEFAULT '';
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "trading_name" VARCHAR(512) NOT NULL DEFAULT '';
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "firm_name" VARCHAR(512) NOT NULL DEFAULT '';
