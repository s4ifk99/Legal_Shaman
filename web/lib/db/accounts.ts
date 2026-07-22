import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@/lib/db/prisma";

/**
 * Accounts DB (Neon free tier): users, bookmarks, triage feedback emails.
 *
 * Resolution order:
 * 1. ACCOUNTS_DATABASE_URL
 * 2. DATABASE_URL (legacy single-DB setups)
 */
function accountsConnectionString(): string | undefined {
  return process.env.ACCOUNTS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
}

const globalForAccounts = globalThis as unknown as {
  accountsPrisma: PrismaClient | undefined;
};

export const accountsPrisma =
  globalForAccounts.accountsPrisma ??
  createPrismaClient({
    connectionString: accountsConnectionString(),
    label: "accounts",
  });

if (process.env.NODE_ENV !== "production") {
  globalForAccounts.accountsPrisma = accountsPrisma;
}
