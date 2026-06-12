import { Prisma } from "@prisma/client";

const warnedSources = new Set<string>();

/** First line only — for compact warn logs. */
export function formatCrawlReviewDatasourceError(error: unknown): string {
  return formatFullCrawlReviewDatasourceError(error).split("\n")[0]?.trim() ?? "(empty)";
}

/** Full Prisma / Error detail for review query diagnostics (never truncated). */
export function formatFullCrawlReviewDatasourceError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const parts = [
      `PrismaClientKnownRequestError`,
      `code: ${error.code}`,
      `message: ${error.message}`,
      `clientVersion: ${error.clientVersion}`,
      `meta: ${JSON.stringify(error.meta, null, 2)}`,
    ];
    if (error.stack) parts.push(`stack:\n${error.stack}`);
    return parts.join("\n");
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    const parts = [
      `PrismaClientUnknownRequestError`,
      `message: ${error.message}`,
      `clientVersion: ${error.clientVersion}`,
    ];
    if (error.stack) parts.push(`stack:\n${error.stack}`);
    return parts.join("\n");
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return `PrismaClientInitializationError\nmessage: ${error.message}\n${error.stack ?? ""}`;
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return `PrismaClientRustPanicError\nmessage: ${error.message}\n${error.stack ?? ""}`;
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

/** One structured warning per source per process (no Prisma stack spam). */
export function warnCrawlReviewDatasourceUnavailable(source: string, error: unknown): void {
  if (warnedSources.has(source)) return;
  warnedSources.add(source);
  console.warn(
    JSON.stringify({
      event: "providers_crawl_review_datasource_unavailable",
      source,
      error: formatCrawlReviewDatasourceError(error),
    }),
  );
}

export function resetCrawlReviewDatasourceWarnDedupe(): void {
  warnedSources.clear();
}
