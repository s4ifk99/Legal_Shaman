import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma client. Reuse one instance per Node process so we don't
 * exhaust Postgres connections during Next.js dev hot-reloads.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
