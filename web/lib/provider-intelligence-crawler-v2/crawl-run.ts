import { prisma } from "@/lib/db/prisma";
import type { CrawlerV2Stage, CrawlRunStatus } from "@/lib/provider-intelligence-crawler-v2/types";

export async function createCrawlRun(args: {
  entityId: string;
  entityType: string;
  stage: CrawlerV2Stage;
  priority?: number;
  status?: CrawlRunStatus;
}): Promise<string> {
  const row = await prisma.providerCrawlRun.create({
    data: {
      entityId: args.entityId,
      entityType: args.entityType,
      stage: args.stage,
      status: args.status ?? "running",
      priority: args.priority ?? 0,
      startedAt: new Date(),
    },
  });
  return row.id;
}

export async function completeCrawlRun(
  runId: string,
  stats: Record<string, unknown>,
): Promise<void> {
  await prisma.providerCrawlRun.update({
    where: { id: runId },
    data: {
      status: "completed",
      completedAt: new Date(),
      statsJson: JSON.stringify(stats),
      updatedAt: new Date(),
    },
  });
}

export async function failCrawlRun(runId: string, error: string): Promise<void> {
  await prisma.providerCrawlRun.update({
    where: { id: runId },
    data: {
      status: "failed",
      error: error.slice(0, 4000),
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}
