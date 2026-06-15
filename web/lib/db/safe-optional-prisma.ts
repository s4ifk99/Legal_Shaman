import type { PrismaClient } from "@prisma/client";

import { getOptionalPrismaClient } from "@/lib/db/prisma";

const warnedOptionalQueries = new Set<string>();

function formatOptionalPrismaReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const firstLine = error.message.split("\n")[0]?.trim();
  return firstLine || error.message.trim() || "(empty)";
}

export function warnOptionalPrismaUnavailable(queryName: string, error: unknown): void {
  if (warnedOptionalQueries.has(queryName)) return;
  warnedOptionalQueries.add(queryName);
  console.warn(
    JSON.stringify({
      event: "optional_prisma_query_unavailable",
      queryName,
      reason: formatOptionalPrismaReason(error),
    }),
  );
}

/** Clears per-process warn dedupe (for tests). */
export function resetOptionalPrismaWarnDedupe(): void {
  warnedOptionalQueries.clear();
}

/**
 * Runs a non-critical Prisma read on a quiet client (no prisma:error log spam).
 * On failure returns `fallback` and emits a single structured warning.
 */
export async function safeOptionalPrisma<T>(
  queryName: string,
  fn: (db: PrismaClient) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn(getOptionalPrismaClient());
  } catch (e) {
    warnOptionalPrismaUnavailable(queryName, e);
    return fallback;
  }
}
