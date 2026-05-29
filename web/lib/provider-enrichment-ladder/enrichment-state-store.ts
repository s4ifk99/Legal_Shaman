import { prisma } from "@/lib/db/prisma";
import {
  canTransition,
  type EnrichmentLadderStatus,
} from "@/lib/provider-enrichment-ladder/enrichment-state";

export type StoredEnrichmentState = {
  entityId: string;
  entityType: string;
  status: EnrichmentLadderStatus;
  priorityScore: number;
  lastError?: string;
  discoveredWebsite?: string;
  attempts: number;
  updatedAt: Date;
};

export async function getEnrichmentState(
  entityId: string,
): Promise<StoredEnrichmentState | null> {
  try {
    const row = await prisma.providerEnrichmentState.findUnique({
      where: { entityId },
    });
    if (!row) return null;
    return {
      entityId: row.entityId,
      entityType: row.entityType,
      status: row.status as EnrichmentLadderStatus,
      priorityScore: row.priorityScore,
      lastError: row.lastError ?? undefined,
      discoveredWebsite: row.discoveredWebsite ?? undefined,
      attempts: row.attempts,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function upsertEnrichmentState(args: {
  entityId: string;
  entityType: string;
  status: EnrichmentLadderStatus;
  priorityScore?: number;
  lastError?: string | null;
  discoveredWebsite?: string | null;
  incrementAttempts?: boolean;
}): Promise<void> {
  const existing = await getEnrichmentState(args.entityId);
  if (existing && !canTransition(existing.status, args.status)) {
    return;
  }
  try {
    await prisma.providerEnrichmentState.upsert({
      where: { entityId: args.entityId },
      create: {
        entityId: args.entityId,
        entityType: args.entityType,
        status: args.status,
        priorityScore: args.priorityScore ?? 0,
        lastError: args.lastError ?? null,
        discoveredWebsite: args.discoveredWebsite ?? null,
        attempts: args.incrementAttempts ? 1 : 0,
      },
      update: {
        status: args.status,
        priorityScore: args.priorityScore,
        lastError: args.lastError,
        discoveredWebsite: args.discoveredWebsite,
        attempts: args.incrementAttempts
          ? { increment: 1 }
          : undefined,
        updatedAt: new Date(),
      },
    });
  } catch {
    /* DB unavailable */
  }
}

export async function countByLadderStatus(): Promise<Record<string, number>> {
  try {
    const rows = await prisma.providerEnrichmentState.groupBy({
      by: ["status"],
      _count: { entityId: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r._count.entityId;
    return out;
  } catch {
    return {};
  }
}
