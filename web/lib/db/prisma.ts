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
 * Prefer `sslmode=verify-full` so `pg` does not warn that require/verify-ca
 * are aliases, and so the upcoming pg v9 change is a no-op.
 */
function isLoopbackDbHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "host.docker.internal";
}

export function withVerifyFullSsl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (isLoopbackDbHost(url.hostname)) return connectionString;
    const mode = (url.searchParams.get("sslmode") || "").toLowerCase();
    if (mode === "disable" || mode === "allow") return connectionString;
    if (!mode && !url.hostname.endsWith(".neon.tech")) return connectionString;
    if (!mode || mode === "require" || mode === "prefer" || mode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

/** Use Neon's pooled host on serverless to cut connection/transfer churn. */
export function withNeonPoolerIfNeeded(connectionString: string): string {
  if (/^(0|false|no|off)$/i.test(process.env.DATABASE_USE_NEON_POOLER?.trim() || "")) {
    return connectionString;
  }
  try {
    const url = new URL(connectionString);
    if (!url.hostname.endsWith(".neon.tech") || url.hostname.includes("-pooler.")) {
      return connectionString;
    }
    const dot = url.hostname.indexOf(".");
    if (dot <= 0) return connectionString;
    url.hostname = `${url.hostname.slice(0, dot)}-pooler${url.hostname.slice(dot)}`;
    return url.toString();
  } catch {
    return connectionString;
  }
}

function prepareConnectionString(connectionString: string): string {
  return withVerifyFullSsl(withNeonPoolerIfNeeded(connectionString));
}

/**
 * Prisma 7 requires a driver adapter (or Accelerate URL) at construction time.
 */
export function createPrismaClient(options?: CreatePrismaClientOptions): PrismaClient {
  const raw = options?.connectionString ?? process.env.DATABASE_URL;
  const label = options?.label ?? "default";
  if (!raw) {
    throw new Error(
      `DATABASE_URL is not set (${label}). Copy .env.example to .env.local and configure Postgres.`,
    );
  }
  const connectionString = prepareConnectionString(raw);

  const connectTimeoutMs = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 30_000);
  const defaultPoolMax = process.env.VERCEL === "1" ? 1 : 10;
  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? defaultPoolMax);

  let ssl: { rejectUnauthorized: true } | undefined;
  try {
    if (new URL(connectionString).searchParams.get("sslmode") === "verify-full") {
      ssl = { rejectUnauthorized: true };
    }
  } catch {
    ssl = undefined;
  }

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: Number.isFinite(connectTimeoutMs) ? connectTimeoutMs : 30_000,
    max: Number.isFinite(poolMax) ? poolMax : defaultPoolMax,
    ...(ssl ? { ssl } : {}),
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
