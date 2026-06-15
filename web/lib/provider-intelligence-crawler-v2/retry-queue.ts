import { prisma } from "@/lib/db/prisma";

const BASE_BACKOFF_MS = Number(process.env.CRAWLER_V2_RETRY_BACKOFF_MS ?? "300000");

export async function markRunForRetry(runId: string, error: string): Promise<boolean> {
  const run = await prisma.providerCrawlRun.findUnique({ where: { id: runId } });
  if (!run) return false;

  const attempts = run.attempts + 1;
  if (attempts >= run.maxAttempts) {
    await prisma.providerCrawlRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        attempts,
        error: error.slice(0, 4000),
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return false;
  }

  const delay = BASE_BACKOFF_MS * Math.pow(2, attempts - 1);
  await prisma.providerCrawlRun.update({
    where: { id: runId },
    data: {
      status: "retry",
      attempts,
      error: error.slice(0, 4000),
      scheduledAt: new Date(Date.now() + delay),
      startedAt: null,
      completedAt: null,
      updatedAt: new Date(),
    },
  });
  return true;
}

export async function claimQueuedRun(runId: string): Promise<boolean> {
  const updated = await prisma.providerCrawlRun.updateMany({
    where: { id: runId, status: { in: ["queued", "retry"] } },
    data: { status: "running", startedAt: new Date(), updatedAt: new Date() },
  });
  return updated.count > 0;
}
