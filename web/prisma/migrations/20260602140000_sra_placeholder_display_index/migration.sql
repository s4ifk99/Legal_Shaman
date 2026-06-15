-- Speed up missing-identity recovery scans for placeholder display names.
CREATE INDEX IF NOT EXISTS "sra_organisations_placeholder_display_sra_id_idx"
  ON "sra_organisations" ("sra_id")
  WHERE "display_name" LIKE 'SRA organisation%';
