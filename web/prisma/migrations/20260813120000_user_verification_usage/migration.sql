-- Email verification + usage tracking for Coherence quota enforcement.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "plan" VARCHAR(32) NOT NULL DEFAULT 'free';

-- Grandfather existing accounts so they are not locked out.
UPDATE "users"
SET "email_verified_at" = COALESCE("email_verified_at", "created_at")
WHERE "email_verified_at" IS NULL;

CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "token_hash" VARCHAR(128) NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("token_hash")
);

CREATE INDEX IF NOT EXISTS "email_verification_tokens_user_id_idx"
  ON "email_verification_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_expires_at_idx"
  ON "email_verification_tokens"("expires_at");

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "request_id" VARCHAR(64),
  "endpoint" VARCHAR(128) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'started',
  "llm_calls" INTEGER NOT NULL DEFAULT 0,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "usage_events_user_id_created_at_idx"
  ON "usage_events"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "usage_events_user_id_endpoint_created_at_idx"
  ON "usage_events"("user_id", "endpoint", "created_at");

ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
