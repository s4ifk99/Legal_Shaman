import "server-only";

import { accountsPrisma } from "@/lib/db/accounts";

let schemaReady: Promise<void> | null = null;

/** Ensure password reset table exists before first use (prod migration lag). */
export function ensurePasswordResetSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await accountsPrisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
          "token_hash" VARCHAR(128) PRIMARY KEY,
          "user_id" TEXT NOT NULL,
          "expires_at" TIMESTAMPTZ(3) NOT NULL,
          "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
        )
      `);
      await accountsPrisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx"
          ON "password_reset_tokens"("user_id")
      `);
      await accountsPrisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_at_idx"
          ON "password_reset_tokens"("expires_at")
      `);
      await accountsPrisma.$executeRawUnsafe(`
        DO $$ BEGIN
          ALTER TABLE "password_reset_tokens"
            ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}
