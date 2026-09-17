CREATE TABLE IF NOT EXISTS "chronology_shares" (
  "id" TEXT NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "update_token_hash" VARCHAR(128) NOT NULL,
  "brief_id" VARCHAR(128) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "consent_at" TIMESTAMPTZ(3) NOT NULL,
  "published_at" TIMESTAMPTZ(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "chronology_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "chronology_shares_token_hash_key"
  ON "chronology_shares"("token_hash");
CREATE INDEX IF NOT EXISTS "chronology_shares_expires_at_idx"
  ON "chronology_shares"("expires_at");
CREATE INDEX IF NOT EXISTS "chronology_shares_brief_id_idx"
  ON "chronology_shares"("brief_id");
CREATE INDEX IF NOT EXISTS "chronology_shares_update_token_hash_idx"
  ON "chronology_shares"("update_token_hash");
