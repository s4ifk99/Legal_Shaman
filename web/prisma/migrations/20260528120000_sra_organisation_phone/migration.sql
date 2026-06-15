-- Add telephone from SRA office records for directory display.
ALTER TABLE "sra_organisations" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(64) NOT NULL DEFAULT '';
