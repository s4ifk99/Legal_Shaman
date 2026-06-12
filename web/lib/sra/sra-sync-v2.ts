import type { PrismaClient } from "@prisma/client";
import { MeiliSearch } from "meilisearch";

import {
  normaliseSraOrganisationV2,
  sraNumberFromRaw,
  sraNumberSortKey,
  type SraV2Record,
} from "@/lib/search/sra-document";
import { ensureSraIndex } from "@/lib/search/meilisearch-index";
import { SRA_MEILISEARCH_INDEX } from "@/lib/search/meilisearch-config";
import { upsertFirmFromSraV2, upsertSraV2Record } from "@/lib/sra-mysql-sync";
import { linkFirmsToSra } from "@/lib/sra/link-firms";
import {
  clearSraSyncCheckpoint,
  readSraSyncCheckpoint,
  SRA_SYNC_CHECKPOINT_INTERVAL,
  sraSyncCheckpointPath,
  writeSraSyncCheckpoint,
} from "@/lib/sra/sra-sync-checkpoint";
import {
  collectSraDbCoverage,
  formatCoverageComparison,
  metricsFromV2Batch,
  type SraCoverageMetrics,
} from "@/lib/sra/sra-sync-coverage";
import {
  purgeStaleSraOrganisations,
  writeActiveSraIdSnapshot,
} from "@/lib/sra/purge-stale-organisations";
import { activeSraIdsFromGetAllRows, fetchAllOrganisationsFromApi } from "@/lib/sra/sra-fetch";
import { syncLegalEntitiesToTypesense } from "@/lib/search-index/sync-typesense";
import { writeSraSyncState } from "@/lib/sra/sync-state";

const DEFAULT_SRA_URL =
  "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll";

const LOG_CHUNK = 100;

export type SraV2SyncOptions = {
  limit?: number | null;
  offset?: number | null;
  resume?: boolean;
  checkpoint?: boolean;
  skipEmbeddings?: boolean;
  skipTypesense?: boolean;
  skipLinkFirms?: boolean;
  skipPurge?: boolean;
  meiliEnabled?: boolean;
  meiliHost?: string;
  meiliKey?: string;
};

export type SraV2SyncResult = {
  fetched: number;
  processed: number;
  skipped: number;
  failed: number;
  syncedSraIds: string[];
  beforeMetrics: SraCoverageMetrics;
  afterMetrics: SraCoverageMetrics;
  batchMetrics: SraCoverageMetrics;
  coverageComparison: ReturnType<typeof formatCoverageComparison>;
  typesenseUpserted: number;
  purged?: Awaited<ReturnType<typeof purgeStaleSraOrganisations>>;
  completed: boolean;
};

async function fetchAllOrganisations(key: string, startUrl: string): Promise<Record<string, unknown>[]> {
  return fetchAllOrganisationsFromApi(key, startUrl);
}

function sortBySraNumber(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort(
    (a, b) => sraNumberSortKey(sraNumberFromRaw(a)) - sraNumberSortKey(sraNumberFromRaw(b)),
  );
}

function filterAfterResume(
  rows: Record<string, unknown>[],
  lastSuccessfulSraNumber: string | null,
): Record<string, unknown>[] {
  if (!lastSuccessfulSraNumber) return rows;
  const resumeAfter = sraNumberSortKey(lastSuccessfulSraNumber);
  return rows.filter((r) => sraNumberSortKey(sraNumberFromRaw(r)) > resumeAfter);
}

function isFullSyncRun(options: SraV2SyncOptions): boolean {
  return (
    options.limit == null &&
    options.offset == null &&
    !options.resume
  );
}

export async function runSraV2Sync(
  prisma: PrismaClient,
  sraKey: string,
  options: SraV2SyncOptions,
): Promise<SraV2SyncResult> {
  const startUrl = process.env.SRA_ORGANISATIONS_URL?.trim() || DEFAULT_SRA_URL;
  const checkpointEnabled = options.checkpoint !== false;
  const runStartedAt = new Date().toISOString();

  const beforeMetrics = await collectSraDbCoverage(prisma);

  let checkpoint = options.resume ? await readSraSyncCheckpoint() : null;
  if (options.resume && checkpoint?.lastSuccessfulSraNumber) {
    console.log(
      `Resuming after SraNumber ${checkpoint.lastSuccessfulSraNumber} (${checkpoint.processedCount} previously processed).`,
    );
  } else if (options.resume) {
    console.log("--resume: no checkpoint found, starting from beginning.");
    checkpoint = null;
  }

  console.log("Fetching SRA organisations from:", startUrl);
  const fetched = await fetchAllOrganisations(sraKey, startUrl);
  console.log("Raw organisation rows:", fetched.length);

  const activeSraIds = activeSraIdsFromGetAllRows(fetched);
  await writeActiveSraIdSnapshot(activeSraIds);

  let queue = sortBySraNumber(fetched);
  const skippedResume = queue.length;
  queue = filterAfterResume(queue, checkpoint?.lastSuccessfulSraNumber ?? null);
  const skippedByResume = skippedResume - queue.length;

  if (options.offset != null && options.offset > 0) {
    queue = queue.slice(options.offset);
    console.log(`--offset=${options.offset}: skipping to position ${options.offset} in remaining queue.`);
  }

  if (options.limit != null) {
    queue = queue.slice(0, options.limit);
    console.log(`--limit=${options.limit}: processing ${queue.length} organisations.`);
  }

  const syncedSraIds: string[] = [];
  const batchDocs: SraV2Record[] = [];
  const meiliBuffer: SraV2Record[] = [];
  let processed = 0;
  let failed = 0;
  let lastSuccessfulSraNumber: string | null = checkpoint?.lastSuccessfulSraNumber ?? null;

  const flushMeili = async () => {
    if (!meiliIndex || !meiliClient || meiliBuffer.length === 0) return;
    const chunk = meiliBuffer.splice(0, meiliBuffer.length);
    const task = await meiliIndex.addDocuments(chunk);
    await meiliClient.tasks.waitForTask(task.taskUid, { timeout: 600_000 });
  };

  const meiliClient =
    options.meiliEnabled && options.meiliHost
      ? new MeiliSearch({ host: options.meiliHost, apiKey: options.meiliKey ?? "" })
      : null;
  if (meiliClient) await ensureSraIndex(meiliClient);
  const meiliIndex = meiliClient?.index(SRA_MEILISEARCH_INDEX);

  const embedKey = process.env.LLM_API_KEY?.trim();
  const willEmbed = Boolean(embedKey) && !options.skipEmbeddings;

  for (const raw of queue) {
    const doc = normaliseSraOrganisationV2(raw);
    if (!doc) {
      failed++;
      continue;
    }

    try {
      await upsertSraV2Record(prisma, doc);
      await upsertFirmFromSraV2(prisma, doc);
      syncedSraIds.push(doc.sraId);
      batchDocs.push(doc);
      processed++;
      lastSuccessfulSraNumber = doc.sraId;

      if (meiliIndex && meiliClient) {
        meiliBuffer.push(doc);
        if (meiliBuffer.length >= LOG_CHUNK) await flushMeili();
      }

      if (checkpointEnabled && processed % SRA_SYNC_CHECKPOINT_INTERVAL === 0) {
        await writeSraSyncCheckpoint({
          version: 2,
          lastSuccessfulSraNumber,
          processedCount: (checkpoint?.processedCount ?? 0) + processed,
          runStartedAt: checkpoint?.runStartedAt ?? runStartedAt,
          checkpointAt: new Date().toISOString(),
          beforeMetrics: checkpoint?.beforeMetrics ?? beforeMetrics,
        });
        console.log(
          `Checkpoint @ ${processed} (SraNumber ${lastSuccessfulSraNumber}) → ${sraSyncCheckpointPath()}`,
        );
      }

      if (processed % LOG_CHUNK === 0) {
        console.log(`Upserted ${processed}/${queue.length} (last SraNumber ${lastSuccessfulSraNumber})…`);
      }
    } catch (err) {
      failed++;
      console.error(
        `Failed upsert sra-${doc.sraId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await flushMeili();

  if (willEmbed && batchDocs.length > 0) {
    try {
      const { embedSraOrgsByIds } = await import("@/lib/sra/embed");
      const ids = batchDocs.map((d) => d.id);
      const n = await embedSraOrgsByIds(ids);
      console.log(`Embedded ${n}/${ids.length} SRA orgs.`);
    } catch (err) {
      console.warn(
        `[sra:sync] embedding failed (continuing):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const completed = processed === queue.length && failed === 0;
  if (completed && checkpointEnabled) {
    await clearSraSyncCheckpoint();
    console.log("Sync complete — checkpoint cleared.");
  } else if (checkpointEnabled && processed > 0) {
    await writeSraSyncCheckpoint({
      version: 2,
      lastSuccessfulSraNumber,
      processedCount: (checkpoint?.processedCount ?? 0) + processed,
      runStartedAt: checkpoint?.runStartedAt ?? runStartedAt,
      checkpointAt: new Date().toISOString(),
      beforeMetrics: checkpoint?.beforeMetrics ?? beforeMetrics,
    });
  }

  let typesenseUpserted = 0;
  if (!options.skipTypesense && syncedSraIds.length > 0) {
    console.log("Updating Typesense (SRA source)…");
    const isPartial = Boolean(options.limit) || Boolean(options.resume) || Boolean(options.offset);
    const stats = await syncLegalEntitiesToTypesense("sra", {
      skipEnrichment: isPartial,
      sraIds: isPartial ? syncedSraIds : undefined,
    });
    typesenseUpserted = stats.documentsUpserted;
    if (stats.errors.length) {
      console.warn("Typesense sync errors:", stats.errors.join("; "));
    }
  }

  const afterMetrics = await collectSraDbCoverage(prisma);
  const batchMetrics = metricsFromV2Batch(batchDocs);
  const coverageComparison = formatCoverageComparison(
    checkpoint?.beforeMetrics ?? beforeMetrics,
    afterMetrics,
  );

  if (!options.skipLinkFirms && !options.limit && completed) {
    console.log("Linking existing Firm rows to SRA records by normalised name…");
    const linkResult = await linkFirmsToSra();
    console.log(
      `Linked ${linkResult.linked} firms; ${linkResult.skipped} skipped, ${linkResult.ambiguous} ambiguous.`,
    );
  }

  let purged: Awaited<ReturnType<typeof purgeStaleSraOrganisations>> | undefined;
  if (completed && isFullSyncRun(options) && !options.skipPurge) {
    console.log("Purging SRA organisations not in latest GetAll…");
    purged = await purgeStaleSraOrganisations(prisma, {
      activeSraIds,
      skipTypesense: options.skipTypesense,
    });
    if ((purged.staleCount ?? 0) > 0 && !options.skipTypesense) {
      console.log("Re-indexing SRA source after purge…");
      const stats = await syncLegalEntitiesToTypesense("sra", { skipEnrichment: true });
      typesenseUpserted = stats.documentsUpserted;
    }
  }

  await writeSraSyncState({
    lastSuccessAt: new Date().toISOString(),
    organisationsUpserted: processed,
    activeGetAllCount: activeSraIds.length,
    errors: failed ? [`${failed} upsert failures`] : [],
    ...(options.limit != null ? { partialSyncLimit: options.limit } : {}),
  });

  console.log("\n=== SRA v2 sync batch metrics ===");
  console.log(JSON.stringify(batchMetrics, null, 2));
  console.log("\n=== Coverage comparison (before → after) ===");
  console.log(JSON.stringify(coverageComparison, null, 2));

  return {
    fetched: fetched.length,
    processed,
    skipped: skippedByResume + (options.offset ?? 0),
    failed,
    syncedSraIds,
    beforeMetrics: checkpoint?.beforeMetrics ?? beforeMetrics,
    afterMetrics,
    batchMetrics,
    coverageComparison,
    typesenseUpserted,
    purged,
    completed,
  };
}
