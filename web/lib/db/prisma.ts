import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export type CreatePrismaClientOptions = {
  /** When true, omit error-level Prisma logs (for optional catalogue / signal reads). */
  quiet?: boolean;
};

/**
 * Prisma 7 requires a driver adapter (or Accelerate URL) at construction time.
 */
export function createPrismaClient(options?: CreatePrismaClientOptions): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and configure Postgres.",
    );
  }

  const adapter = new PrismaPg({ connectionString });
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
 * Singleton Prisma client. Reuse one instance per Node process so we don't
 * exhaust Postgres connections during Next.js dev hot-reloads.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
