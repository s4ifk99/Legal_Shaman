import { prisma } from "@/lib/db/prisma";
import {
  shortDbErrorMessage,
  withDbRetry,
} from "@/lib/sra/missing-identity-recovery/load-organisation-batch";
import type { CrawlerV2Stage } from "@/lib/provider-intelligence-crawler-v2/types";

function crawlScheduleRetryConfig(): { maxAttempts: number; baseDelayMs: number } {
  return {
    maxAttempts: Number(process.env.SRA_IDENTITY_DB_RETRY_ATTEMPTS ?? "3"),
    baseDelayMs: Number(process.env.SRA_IDENTITY_DB_RETRY_BASE_MS ?? "750"),
  };
}

export async function scheduleCrawlRun(args: {
  entityId: string;
  entityType: string;
  stage: CrawlerV2Stage;
  priority?: number;
  scheduledAt?: Date;
}): Promise<string> {
  const retry = crawlScheduleRetryConfig();
  const row = await withDbRetry(
    "providerCrawlRun.create",
    () =>
      prisma.providerCrawlRun.create({
        data: {
          entityId: args.entityId,
          entityType: args.entityType,
          stage: args.stage,
          status: "queued",
          priority: args.priority ?? 0,
          scheduledAt: args.scheduledAt ?? new Date(),
        },
      }),
    retry,
  );
  return row.id;
}

export { shortDbErrorMessage as crawlScheduleErrorMessage };

export async function scheduleCrawlRuns(
  targets: { entityId: string; entityType: string; priority?: number }[],
  stage: CrawlerV2Stage,
): Promise<number> {
  let n = 0;
  for (const t of targets) {
    await scheduleCrawlRun({
      entityId: t.entityId,
      entityType: t.entityType,
      stage,
      priority: t.priority,
    });
    n++;
  }
  return n;
}

export async function listDueQueuedRuns(limit = 50): Promise<
  { id: string; entityId: string; entityType: string; stage: CrawlerV2Stage; priority: number }[]
> {
  const rows = await prisma.providerCrawlRun.findMany({
    where: {
      status: { in: ["queued", "retry"] },
      scheduledAt: { lte: new Date() },
    },
    orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    entityId: r.entityId,
    entityType: r.entityType,
    stage: r.stage as CrawlerV2Stage,
    priority: r.priority,
  }));
}
