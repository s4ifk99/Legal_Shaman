import type { Prisma, PrismaClient } from "@prisma/client";

import type { TransferredCounts } from "@/lib/sra/sra-logical-dedupe-types";
import { sraEntityId } from "@/lib/sra/sra-logical-dedupe-scoring";

type TransferOpts = {
  dryRun: boolean;
};

async function moveIds(
  prisma: PrismaClient,
  table: keyof TransferredCounts,
  ids: string[],
  update: (id: string) => Promise<unknown>,
  counts: TransferredCounts,
  dryRun: boolean,
): Promise<void> {
  if (!ids.length) return;
  counts[table] = ids;
  if (!dryRun) {
    for (const id of ids) await update(id);
  }
}

export async function hasApprovedEnrichmentConflict(
  prisma: PrismaClient,
  oldEntityId: string,
  newEntityId: string,
): Promise<boolean> {
  const [oldApproved, newApproved] = await Promise.all([
    prisma.providerEnrichment.findMany({
      where: { entityId: oldEntityId, status: "approved" },
      select: { fieldName: true, extractedValue: true },
    }),
    prisma.providerEnrichment.findMany({
      where: { entityId: newEntityId, status: "approved" },
      select: { fieldName: true, extractedValue: true },
    }),
  ]);
  if (!oldApproved.length) return false;
  const newByField = new Map(newApproved.map((r) => [r.fieldName, r.extractedValue]));
  for (const row of oldApproved) {
    const keeperVal = newByField.get(row.fieldName);
    if (keeperVal != null && keeperVal !== row.extractedValue) return true;
  }
  return false;
}

export async function transferEntityReferences(
  prisma: PrismaClient,
  oldSraId: string,
  newSraId: string,
  opts: TransferOpts,
): Promise<TransferredCounts> {
  const oldEntityId = sraEntityId(oldSraId);
  const newEntityId = sraEntityId(newSraId);
  const oldOrgId = `sra-${oldSraId}`;
  const newOrgId = `sra-${newSraId}`;
  const counts: TransferredCounts = {};

  const pe = await prisma.providerEnrichment.findMany({
    where: { entityId: oldEntityId },
    select: { id: true, fieldName: true, extractedValue: true },
  });
  const movedPe: string[] = [];
  for (const row of pe) {
    const clash = await prisma.providerEnrichment.findFirst({
      where: {
        entityId: newEntityId,
        fieldName: row.fieldName,
        extractedValue: row.extractedValue,
      },
    });
    if (clash) {
      if (!opts.dryRun) await prisma.providerEnrichment.delete({ where: { id: row.id } });
    } else {
      movedPe.push(row.id);
      if (!opts.dryRun) {
        await prisma.providerEnrichment.update({
          where: { id: row.id },
          data: { entityId: newEntityId },
        });
      }
    }
  }
  if (movedPe.length) counts.provider_enrichments = movedPe;

  const simpleTables: {
    key: keyof TransferredCounts;
    find: () => Promise<{ id: string }[]>;
    update: (id: string) => Promise<unknown>;
  }[] = [
    {
      key: "provider_crawl_jobs",
      find: () => prisma.providerCrawlJob.findMany({ where: { entityId: oldEntityId }, select: { id: true } }),
      update: (id) => prisma.providerCrawlJob.update({ where: { id }, data: { entityId: newEntityId } }),
    },
    {
      key: "provider_crawl_results",
      find: () => prisma.providerCrawlResult.findMany({ where: { entityId: oldEntityId }, select: { id: true } }),
      update: (id) => prisma.providerCrawlResult.update({ where: { id }, data: { entityId: newEntityId } }),
    },
    {
      key: "provider_extracted_fields",
      find: () => prisma.providerExtractedField.findMany({ where: { entityId: oldEntityId }, select: { id: true } }),
      update: (id) => prisma.providerExtractedField.update({ where: { id }, data: { entityId: newEntityId } }),
    },
    {
      key: "provider_crawl_runs",
      find: () => prisma.providerCrawlRun.findMany({ where: { entityId: oldEntityId }, select: { id: true } }),
      update: (id) => prisma.providerCrawlRun.update({ where: { id }, data: { entityId: newEntityId } }),
    },
    {
      key: "indexing_jobs",
      find: () => prisma.indexingJob.findMany({ where: { entityId: oldEntityId }, select: { id: true } }),
      update: (id) => prisma.indexingJob.update({ where: { id }, data: { entityId: newEntityId } }),
    },
    {
      key: "search_ranking_signals",
      find: () => prisma.searchRankingSignal.findMany({ where: { entityId: oldEntityId }, select: { id: true } }),
      update: (id) => prisma.searchRankingSignal.update({ where: { id }, data: { entityId: newEntityId } }),
    },
  ];

  for (const t of simpleTables) {
    const rows = await t.find();
    await moveIds(prisma, t.key, rows.map((r) => r.id), t.update, counts, opts.dryRun);
  }

  const oldState = await prisma.providerEnrichmentState.findUnique({ where: { entityId: oldEntityId } });
  if (oldState) {
    const newState = await prisma.providerEnrichmentState.findUnique({ where: { entityId: newEntityId } });
    counts.provider_enrichment_states = [oldState.entityId];
    if (!opts.dryRun) {
      if (newState) {
        await prisma.providerEnrichmentState.update({
          where: { entityId: newEntityId },
          data: {
            attempts: Math.max(newState.attempts, oldState.attempts),
            priorityScore: Math.max(newState.priorityScore, oldState.priorityScore),
            discoveredWebsite: newState.discoveredWebsite || oldState.discoveredWebsite,
          },
        });
        await prisma.providerEnrichmentState.delete({ where: { entityId: oldEntityId } });
      } else {
        await prisma.providerEnrichmentState.update({
          where: { entityId: oldEntityId },
          data: { entityId: newEntityId },
        });
      }
    }
  }

  for (const [model, key] of [
    [prisma.providerWebsite, "provider_websites"],
    [prisma.providerContact, "provider_contacts"],
    [prisma.providerPracticeArea, "provider_practice_areas"],
    [prisma.providerReviewSignal, "provider_review_signals"],
  ] as const) {
    const rows = await (model as typeof prisma.providerWebsite).findMany({
      where: { entityId: oldEntityId },
      select: { id: true },
    });
    const moved: string[] = [];
    for (const row of rows) {
      moved.push(row.id);
      if (!opts.dryRun) {
        await (model as typeof prisma.providerWebsite).update({
          where: { id: row.id },
          data: { entityId: newEntityId },
        });
      }
    }
    if (moved.length) counts[key as keyof TransferredCounts] = moved;
  }

  const identityRows = await prisma.sraIdentityCandidate.findMany({
    where: { organisationId: oldOrgId },
    select: { id: true },
  });
  await moveIds(
    prisma,
    "sra_identity_candidates",
    identityRows.map((r) => r.id),
    (id) =>
      prisma.sraIdentityCandidate.update({
        where: { id },
        data: { organisationId: newOrgId, sraId: newSraId },
      }),
    counts,
    opts.dryRun,
  );

  return counts;
}

export function orgSnapshot(org: {
  id: string;
  sraId: string;
  businessName: string;
  displayName: string;
  organisationName: string;
  searchText: string;
  phone: string;
  email: string;
  website: string;
  postcode: string;
  city: string;
}): Prisma.InputJsonValue {
  return { ...org };
}
