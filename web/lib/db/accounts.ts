import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

import { createPrismaClient } from "@/lib/db/prisma";

/**
 * Accounts DB: users, bookmarks, usage, billing.
 * On Vercel, routes through Envy via WebSocket proxy (ACCOUNTS_WS_PROXY).
 */
function accountsConnectionString(): string | undefined {
  return process.env.ACCOUNTS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
}

function createAccountsPrismaClient(): PrismaClient {
  const connectionString = accountsConnectionString();
  if (!connectionString) {
    throw new Error("ACCOUNTS_DATABASE_URL / DATABASE_URL not set (accounts)");
  }

  const wsProxy = process.env.ACCOUNTS_WS_PROXY?.trim();
  if (wsProxy) {
    neonConfig.webSocketConstructor = ws;
    neonConfig.wsProxy = wsProxy;
    neonConfig.useSecureWebSocket = true;
    neonConfig.forceDisablePgSSL = true;
    neonConfig.pipelineConnect = false;

    const pool = new Pool({ connectionString });
    const adapter = new PrismaNeon(pool);
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  return createPrismaClient({
    connectionString,
    label: "accounts",
  });
}

const globalForAccounts = globalThis as unknown as {
  accountsPrisma: PrismaClient | undefined;
};

function getAccountsPrismaClient(): PrismaClient {
  if (!globalForAccounts.accountsPrisma) {
    globalForAccounts.accountsPrisma = createAccountsPrismaClient();
  }
  return globalForAccounts.accountsPrisma;
}

/** Lazy so Next page-data collection can import login without a live DB. */
export const accountsPrisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getAccountsPrismaClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
