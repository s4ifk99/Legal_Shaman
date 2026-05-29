import { prisma } from "@/lib/db/prisma";

export type IndexingJobStatus = "queued" | "running" | "completed" | "failed";
export type EntitySource = "sra" | "legal_aid" | "probono" | "curated" | "lawyers";

const MAX_ATTEMPTS = 3;

export function normaliseEntitySource(raw: string): EntitySource | null {
  const s = raw.trim().toLowerCase();
  if (s === "sra" || s === "legal_aid" || s === "probono" || s === "curated" || s === "lawyers") {
    return s;
  }
  return null;
}

/** Queue or refresh a queued indexing job for one entity. */
export async function enqueueIndexingJob(args: {
  entityId: string;
  entitySource: EntitySource;
  reason?: string;
}): Promise<{ id: string; created: boolean }> {
  try {
    await prisma.indexingJob.findFirst({ take: 1 });
  } catch {
    return { id: "", created: false };
  }

  const existing = await prisma.indexingJob.findFirst({
    where: {
      entityId: args.entityId,
      entitySource: args.entitySource,
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }

  const row = await prisma.indexingJob.create({
    data: {
      entityId: args.entityId,
      entitySource: args.entitySource,
      status: "queued",
      reason: args.reason ?? "enrichment_approved",
    },
  });
  return { id: row.id, created: true };
}

export async function listIndexingJobs(opts?: {
  status?: IndexingJobStatus | IndexingJobStatus[];
  limit?: number;
}): Promise<
  {
    id: string;
    entityId: string;
    entitySource: string;
    status: string;
    reason: string | null;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }[]
> {
  const status = opts?.status;
  try {
    return await prisma.indexingJob.findMany({
      where: status
        ? {
            status: Array.isArray(status) ? { in: status } : status,
          }
        : undefined,
      orderBy: { createdAt: "asc" },
      take: opts?.limit ?? 100,
    });
  } catch {
    return [];
  }
}

export async function claimIndexingJob(id: string): Promise<boolean> {
  try {
    await prisma.indexingJob.update({
      where: { id, status: "queued" },
      data: { status: "running", attempts: { increment: 1 }, updatedAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

export async function completeIndexingJob(id: string): Promise<void> {
  await prisma.indexingJob.update({
    where: { id },
    data: {
      status: "completed",
      lastError: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function failIndexingJob(id: string, error: string): Promise<void> {
  const row = await prisma.indexingJob.findUnique({ where: { id } });
  if (!row) return;
  const attempts = row.attempts;
  const requeue = attempts < MAX_ATTEMPTS;
  await prisma.indexingJob.update({
    where: { id },
    data: {
      status: requeue ? "queued" : "failed",
      lastError: error.slice(0, 4000),
      completedAt: requeue ? null : new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function countIndexingJobsByStatus(): Promise<Record<string, number>> {
  try {
    const rows = await prisma.indexingJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  } catch {
    return {};
  }
}

/** Infer entity source from Typesense entity id prefix. */
export function inferEntitySourceFromId(entityId: string): EntitySource | null {
  if (entityId.startsWith("sra:")) return "sra";
  if (entityId.startsWith("legal_aid:")) return "legal_aid";
  if (entityId.startsWith("curated:")) return "curated";
  if (entityId.startsWith("probono:")) return "probono";
  if (entityId.startsWith("lawyer:")) return "lawyers";
  return null;
}
