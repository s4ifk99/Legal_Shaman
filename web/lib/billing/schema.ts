import "server-only";

import { accountsPrisma } from "@/lib/db/accounts";

let schemaReady: Promise<void> | null = null;

/**
 * Keep production accounts databases compatible with the current quota and
 * billing client until the deployment migration job is available.
 */
export function ensureBillingSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await accountsPrisma.$executeRawUnsafe(`
        ALTER TABLE "usage_events"
          ADD COLUMN IF NOT EXISTS "search_key" VARCHAR(128)
      `);
      await accountsPrisma.$executeRawUnsafe(`
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
        )
      `);
      await accountsPrisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "billing_subscriptions_status_period_idx"
          ON "billing_subscriptions" ("status", "current_period_end")
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}
