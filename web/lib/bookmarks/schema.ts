import "server-only";

import { accountsPrisma } from "@/lib/db/accounts";

let schemaReady: Promise<void> | null = null;

/**
 * Keep production accounts DBs compatible with bookmark notes / status fields
 * when migrate deploy has not yet been run against the live Neon branch.
 */
export function ensureBookmarkSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await accountsPrisma.$executeRawUnsafe(`
        ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "note" VARCHAR(2000)
      `);
      await accountsPrisma.$executeRawUnsafe(`
        ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "next_action" VARCHAR(500)
      `);
      await accountsPrisma.$executeRawUnsafe(`
        ALTER TABLE "bookmarks"
          ADD COLUMN IF NOT EXISTS "status" VARCHAR(32) NOT NULL DEFAULT 'not_contacted'
      `);
      await accountsPrisma.$executeRawUnsafe(`
        ALTER TABLE "bookmarks"
          ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}
