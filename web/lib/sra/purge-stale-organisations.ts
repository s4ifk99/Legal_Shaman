import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";

const ACTIVE_IDS_PATH = path.join(process.cwd(), ".sra-sync-active-ids.json");
const DELETE_BATCH = 200;

export type PurgeStaleOrganisationsOptions = {
  activeSraIds: Iterable<string>;
  dryRun?: boolean;
  skipTypesense?: boolean;
  reason?: string;
};

export type PurgeStaleOrganisationsResult = {
  activeCount: number;
  staleCount: number;
  archived: number;
  deleted: number;
  typesenseDeleted: number;
  dryRun: boolean;
};

/**
 * Persist the latest GetAll SRA id set for offline purge / audit scripts.
 */
export async function writeActiveSraIdSnapshot(activeSraIds: string[]): Promise<string> {
  const unique = [...new Set(activeSraIds.map((id) => id.trim()).filter(Boolean))].sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  );
  await writeFile(
    ACTIVE_IDS_PATH,
    `${JSON.stringify({ writtenAt: new Date().toISOString(), count: unique.length, sraIds: unique }, null, 2)}\n`,
    "utf8",
  );
  return ACTIVE_IDS_PATH;
}

export async function readActiveSraIdSnapshot(): Promise<string[]> {
  try {
    const raw = await readFile(ACTIVE_IDS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { sraIds?: string[] };
    return Array.isArray(parsed.sraIds) ? parsed.sraIds : [];
  } catch {
    return [];
  }
}

async function deleteTypesenseSraDocuments(ids: string[]): Promise<number> {
  const client = buildTypesenseListingsClientFromEnv();
  if (!client || ids.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const batch = ids.slice(i, i + DELETE_BATCH);
    const filterBy = `id:[${batch.map((id) => `\`${id}\``).join(",")}]`;
    try {
      await client.collections(LEGAL_ENTITIES_COLLECTION).documents().delete({ filter_by: filterBy });
      deleted += batch.length;
    } catch (err) {
      console.warn(
        "[sra:purge-stale] Typesense delete batch failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return deleted;
}

/**
 * Archive and delete SRA organisations not present in the latest GetAll fetch.
 */
export async function purgeStaleSraOrganisations(
  prisma: PrismaClient,
  options: PurgeStaleOrganisationsOptions,
): Promise<PurgeStaleOrganisationsResult> {
  const activeSet = new Set(
    [...options.activeSraIds].map((id) => id.trim()).filter(Boolean),
  );
  if (activeSet.size === 0) {
    throw new Error("activeSraIds must not be empty — refusing to purge entire table");
  }

  const staleRows = await prisma.sraOrganisation.findMany({
    where: { sraId: { notIn: [...activeSet] } },
    select: {
      id: true,
      sraId: true,
      businessName: true,
      displayName: true,
      searchText: true,
      city: true,
      postcode: true,
      county: true,
      country: true,
      sraProfileUrl: true,
      source: true,
      phone: true,
      website: true,
      email: true,
      organisationName: true,
      tradingName: true,
      firmName: true,
      tradingNames: true,
      previousNames: true,
      workArea: true,
      authorisationStatus: true,
      offices: true,
      rawPayload: true,
      updatedAt: true,
    },
  });

  const result: PurgeStaleOrganisationsResult = {
    activeCount: activeSet.size,
    staleCount: staleRows.length,
    archived: 0,
    deleted: 0,
    typesenseDeleted: 0,
    dryRun: Boolean(options.dryRun),
  };

  if (staleRows.length === 0) {
    return result;
  }

  const staleSraIds = staleRows.map((r) => r.sraId);
  const typesenseIds = staleSraIds.map((sraId) => `sra:${sraId}`);

  if (options.dryRun) {
    console.info(
      JSON.stringify({
        event: "sra_purge_stale_dry_run",
        staleCount: staleRows.length,
        sampleSraIds: staleSraIds.slice(0, 10),
      }),
    );
    return result;
  }

  const reason = options.reason ?? "not_in_getall";

  for (let i = 0; i < staleRows.length; i += DELETE_BATCH) {
    const batch = staleRows.slice(i, i + DELETE_BATCH);
    await prisma.sraOrganisationArchive.createMany({
      data: batch.map((row) => ({
        sraId: row.sraId,
        snapshot: row,
        reason,
      })),
    });
    result.archived += batch.length;
  }

  await prisma.firm.updateMany({
    where: { sraId: { in: staleSraIds } },
    data: { sraId: null, sraProfileUrl: null },
  });

  for (let i = 0; i < staleRows.length; i += DELETE_BATCH) {
    const batchIds = staleRows.slice(i, i + DELETE_BATCH).map((r) => r.id);
    const deleted = await prisma.sraOrganisation.deleteMany({
      where: { id: { in: batchIds } },
    });
    result.deleted += deleted.count;
  }

  if (!options.skipTypesense) {
    result.typesenseDeleted = await deleteTypesenseSraDocuments(typesenseIds);
  }

  console.info(
    JSON.stringify({
      event: "sra_purge_stale_complete",
      ...result,
    }),
  );

  return result;
}
