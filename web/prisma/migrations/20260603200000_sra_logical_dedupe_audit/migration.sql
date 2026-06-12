CREATE TABLE IF NOT EXISTS "sra_logical_dedupe_audit" (
  "id" TEXT NOT NULL,
  "old_sra_id" VARCHAR(64) NOT NULL,
  "new_sra_id" VARCHAR(64) NOT NULL,
  "reason" VARCHAR(64) NOT NULL,
  "transferred_counts" JSONB NOT NULL,
  "old_snapshot" JSONB NOT NULL,
  "new_snapshot" JSONB NOT NULL,
  "dry_run" BOOLEAN NOT NULL DEFAULT false,
  "restored_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sra_logical_dedupe_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sra_logical_dedupe_audit_old_sra_id_idx"
  ON "sra_logical_dedupe_audit" ("old_sra_id");

CREATE INDEX IF NOT EXISTS "sra_logical_dedupe_audit_new_sra_id_idx"
  ON "sra_logical_dedupe_audit" ("new_sra_id");
