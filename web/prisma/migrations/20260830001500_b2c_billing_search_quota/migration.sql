ALTER TABLE "usage_events"
  ADD COLUMN IF NOT EXISTS "search_key" VARCHAR(128);

CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL UNIQUE,
  "provider_customer_id" VARCHAR(128) UNIQUE,
  "provider_subscription_id" VARCHAR(128) UNIQUE,
  "status" VARCHAR(32) NOT NULL,
  "current_period_end" TIMESTAMPTZ(3),
  "provider" VARCHAR(32) NOT NULL DEFAULT 'stripe',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "billing_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "billing_subscriptions_status_period_idx"
  ON "billing_subscriptions" ("status", "current_period_end");
