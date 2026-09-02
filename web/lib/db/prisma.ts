import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

export type CreatePrismaClientOptions = {
  /** When true, omit error-level Prisma logs (for optional catalogue / signal reads). */
  quiet?: boolean;
  /**
   * Explicit connection string. When omitted, uses DATABASE_URL.
   * Prefer ACCOUNTS_DATABASE_URL / DATA_DATABASE_URL helpers in sibling modules.
   */
  connectionString?: string;
  /** Label for error messages (e.g. "accounts", "data"). */
  label?: string;
};

/**
 * Prisma 7 requires a driver adapter (or Accelerate URL) at construction time.
 */
export function createPrismaClient(options?: CreatePrismaClientOptions): PrismaClient {
  const connectionString = options?.connectionString ?? process.env.DATABASE_URL;
  const label = options?.label ?? "default";
  if (!connectionString) {
    throw new Error(
      `DATABASE_URL is not set (${label}). Copy .env.example to .env.local and configure Postgres.`,
    );
  }

  const connectTimeoutMs = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 30_000);
  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 10);

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: Number.isFinite(connectTimeoutMs) ? connectTimeoutMs : 30_000,
    max: Number.isFinite(poolMax) ? poolMax : 10,
  });
  const adapter = new PrismaPg(pool);
  const log = options?.quiet
    ? ([] as const)
    : process.env.NODE_ENV === "development"
      ? (["warn", "error"] as const)
      : (["error"] as const);

  return new PrismaClient({
    adapter,
    log: [...log],
  });
}

let optionalPrismaClient: PrismaClient | undefined;

/** Quiet client for optional reads — avoids prisma:error noise when tables are missing. */
export function getOptionalPrismaClient(): PrismaClient {
  if (!optionalPrismaClient) {
    optionalPrismaClient = createPrismaClient({ quiet: true });
  }
  return optionalPrismaClient;
}

/**
 * Singleton Prisma client for heavy / catalogue data (SRA, knowledge, search events).
 * Uses DATA_DATABASE_URL when set, otherwise DATABASE_URL.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function dataConnectionString(): string | undefined {
  return process.env.DATA_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
}

function getDataPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient({
      connectionString: dataConnectionString(),
      label: "data",
    });
  }
  return globalForPrisma.prisma;
}

/** Lazy so `next build` / unit eval can import routes without DATABASE_URL. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getDataPrismaClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
