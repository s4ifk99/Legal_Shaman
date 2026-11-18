-- Consumer Case CRM spine (accounts DB)

CREATE TABLE IF NOT EXISTS "cases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "summary" TEXT,
    "matter_type" VARCHAR(128),
    "jurisdiction" VARCHAR(64),
    "location_hint" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'open',
    "funding_knowledge" VARCHAR(32),
    "funding_preference" VARCHAR(32),
    "funding_notes" TEXT,
    "profile_answers" JSONB,
    "action_plan" JSONB,
    "attachments" JSONB,
    "session_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cases_user_id_updated_at_idx" ON "cases"("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "cases_user_id_status_idx" ON "cases"("user_id", "status");

DO $$
BEGIN
  ALTER TABLE "cases"
    ADD CONSTRAINT "cases_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "case_id" TEXT;
CREATE INDEX IF NOT EXISTS "bookmarks_case_id_idx" ON "bookmarks"("case_id");

DO $$
BEGIN
  ALTER TABLE "bookmarks"
    ADD CONSTRAINT "bookmarks_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "cases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "provider_notes" ADD COLUMN IF NOT EXISTS "case_id" TEXT;
CREATE INDEX IF NOT EXISTS "provider_notes_case_id_idx" ON "provider_notes"("case_id");

DO $$
BEGIN
  ALTER TABLE "provider_notes"
    ADD CONSTRAINT "provider_notes_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "cases"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
