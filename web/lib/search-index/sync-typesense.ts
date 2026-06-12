import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import {
  buildCuratedDocuments,
  buildLegalAidDocuments,
  buildLawyerDocuments,
  buildSraDocuments,
  buildSraDocumentsForOrgs,
  buildProBonoDocuments,
  documentToTypesenseRecord,
  documentToTypesenseSraNamePatch,
  fetchFirmNamesForSraIds,
  fetchSraOrganisationPage,
} from "@/lib/search-index/build-legal-entity-doc";
import {
  logSraIndexDegraded,
  logSraIndexPage,
  shortDbErrorMessage,
  sraIndexPageSize,
} from "@/lib/search-index/sra-index-page";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { ensureLegalEntitiesCollection } from "@/lib/search-index/typesense-legal-entities-index";
import { applyProviderIntelligence, loadEnrichmentCache } from "@/lib/search-index/apply-provider-intelligence";
import { enrichLegalEntityForIndex } from "@/lib/search-index/enrich-legal-entity-index";
import type { IndexSource, LegalEntityDocument, SyncStats } from "@/lib/search-index/types";
import { importTypesenseDocumentsInBatches } from "@/lib/search-index/typesense-bulk-import";

export type SyncLegalEntitiesOptions = {
  /** Skip provider enrichment pass (faster SRA name rebuild). */
  skipEnrichment?: boolean;
  /** Use compact Typesense payloads (SRA name/contact fields only). */
  slimRecords?: boolean;
  /** Reindex only these SRA organisation numbers (partial sync). */
  sraIds?: string[];
  /** Cap SRA rows indexed (keyset-paginated). */
  limit?: number;
  /** Resume SRA keyset pagination after this sraId. */
  resumeAfter?: string;
  /** Override default SRA page size (env: SEARCH_INDEX_SRA_PAGE_SIZE). */
  pageSize?: number;
};

async function collectDocuments(
  source: IndexSource,
  options?: SyncLegalEntitiesOptions,
): Promise<LegalEntityDocument[]> {
  const docs: LegalEntityDocument[] = [];
  if (source === "curated" || source === "all") {
    docs.push(...(await buildCuratedDocuments()));
  }
  if (source === "legal_aid" || source === "all") {
    docs.push(...(await buildLegalAidDocuments()));
  }
  if (source === "lawyers" || source === "all") {
    docs.push(...(await buildLawyerDocuments()));
  }
  if (source === "sra" || source === "all") {
    docs.push(
      ...(await buildSraDocuments({
        skipGeo: process.env.SRA_INDEX_SKIP_GEO === "1",
        sraIds: options?.sraIds,
        take: options?.limit,
      })),
    );
  }
  if (source === "probono" || source === "all") {
    docs.push(...(await buildProBonoDocuments()));
  }
  const byId = new Map<string, LegalEntityDocument>();
  for (const d of docs) byId.set(d.id, d);
  return [...byId.values()];
}

async function enrichDocuments(
  raw: LegalEntityDocument[],
  options?: SyncLegalEntitiesOptions,
): Promise<LegalEntityDocument[]> {
  const docs: LegalEntityDocument[] = [];
  for (const d of raw) {
    if (options?.skipEnrichment) {
      docs.push(d);
    } else {
      docs.push(enrichLegalEntityForIndex(await applyProviderIntelligence(d)));
    }
  }
  return docs;
}

async function syncSraDocumentsToTypesense(
  client: NonNullable<ReturnType<typeof buildTypesenseListingsClientFromEnv>>,
  stats: SyncStats,
  options?: SyncLegalEntitiesOptions,
): Promise<void> {
  const pageSize = options?.pageSize ?? sraIndexPageSize();
  const hardLimit = options?.limit;
  let cursor = options?.resumeAfter?.trim() || undefined;
  let pageIndex = 0;
  let lastSuccessfulSraId: string | null = cursor ?? null;
  const buildOptions = {
    skipGeo: process.env.SRA_INDEX_SKIP_GEO === "1",
    sraIds: options?.sraIds,
  };
  const toRecord = options?.slimRecords ? documentToTypesenseSraNamePatch : documentToTypesenseRecord;

  if (options?.sraIds?.length) {
    const rows = await fetchSraOrganisationPage({
      take: options.sraIds.length,
      sraIds: options.sraIds,
    });
    const firmBySraId = await fetchFirmNamesForSraIds(rows.map((r) => r.sraId));
    const raw = await buildSraDocumentsForOrgs(rows, firmBySraId, buildOptions);
    const docs = await enrichDocuments(raw, options);
    stats.documentsBuilt = docs.length;
    for (const d of docs) {
      if (d.locationPoint) stats.geocoded++;
      else stats.skippedNoCoords++;
    }
    const imported = await importTypesenseDocumentsInBatches(
      client,
      LEGAL_ENTITIES_COLLECTION,
      docs.map(toRecord),
    );
    stats.documentsUpserted = imported.documentsUpserted;
    stats.errors.push(...imported.errors);
    return;
  }

  while (true) {
    const remaining = hardLimit != null ? hardLimit - stats.documentsBuilt : pageSize;
    if (hardLimit != null && remaining <= 0) break;

    const take = hardLimit != null ? Math.min(pageSize, remaining) : pageSize;
    pageIndex++;
    const pageStarted = Date.now();
    let docsBuilt = 0;
    let docsUpserted = 0;
    let firstSraId: string | null = null;
    let lastSraId: string | null = null;
    let rowsLoaded = 0;

    try {
      const rows = await fetchSraOrganisationPage({ cursor, take });
      if (!rows.length) break;

      rowsLoaded = rows.length;
      firstSraId = rows[0]!.sraId;
      lastSraId = rows[rows.length - 1]!.sraId;

      const firmBySraId = await fetchFirmNamesForSraIds(rows.map((r) => r.sraId));
      const raw = await buildSraDocumentsForOrgs(rows, firmBySraId, buildOptions);
      const docs = await enrichDocuments(raw, options);
      docsBuilt = docs.length;

      for (const d of docs) {
        if (d.locationPoint) stats.geocoded++;
        else stats.skippedNoCoords++;
      }

      const imported = await importTypesenseDocumentsInBatches(
        client,
        LEGAL_ENTITIES_COLLECTION,
        docs.map(toRecord),
      );
      docsUpserted = imported.documentsUpserted;
      stats.errors.push(...imported.errors);

      stats.documentsBuilt += docsBuilt;
      stats.documentsUpserted += docsUpserted;
      lastSuccessfulSraId = lastSraId;
      cursor = lastSraId;

      logSraIndexPage({
        event: "search_index_sra_page",
        pageIndex,
        rowsLoaded,
        firstSraId,
        lastSraId,
        docsBuilt,
        docsUpserted,
        elapsedMs: Date.now() - pageStarted,
      });

      if (rows.length < take) break;
    } catch (err) {
      const error = shortDbErrorMessage(err);
      stats.degraded = true;
      stats.resumeAfter = lastSuccessfulSraId;
      stats.errors.push(error);
      logSraIndexDegraded({
        event: "search_index_sra_degraded",
        degraded: true,
        resumeAfter: lastSuccessfulSraId,
        lastSuccessfulSraId,
        pageIndex,
        error,
        documentsBuilt: stats.documentsBuilt,
        documentsUpserted: stats.documentsUpserted,
      });
      throw err;
    }
  }
}

export async function syncLegalEntitiesToTypesense(
  source: IndexSource = "all",
  options?: SyncLegalEntitiesOptions,
): Promise<SyncStats> {
  const stats: SyncStats = {
    source,
    documentsBuilt: 0,
    documentsUpserted: 0,
    geocoded: 0,
    skippedNoCoords: 0,
    errors: [],
  };

  const client = buildTypesenseListingsClientFromEnv({ connectionTimeoutSeconds: 120 });
  if (!client) {
    stats.errors.push("TYPESENSE_HOST and TYPESENSE_API_KEY required");
    return stats;
  }

  await ensureLegalEntitiesCollection(client);
  await loadEnrichmentCache();

  if (source === "sra" && !options?.sraIds?.length) {
    try {
      await syncSraDocumentsToTypesense(client, stats, options);
    } catch {
      return stats;
    }
    console.info(
      JSON.stringify({
        event: "search_index_sync",
        collection: LEGAL_ENTITIES_COLLECTION,
        ...stats,
      }),
    );
    return stats;
  }

  const raw = await collectDocuments(source, options);
  const docs = await enrichDocuments(raw, options);
  stats.documentsBuilt = docs.length;

  for (const d of docs) {
    if (d.locationPoint) stats.geocoded++;
    else stats.skippedNoCoords++;
  }

  const toRecord = options?.slimRecords ? documentToTypesenseSraNamePatch : documentToTypesenseRecord;
  const records = docs.map(toRecord);
  const imported = await importTypesenseDocumentsInBatches(
    client,
    LEGAL_ENTITIES_COLLECTION,
    records,
  );
  stats.documentsUpserted = imported.documentsUpserted;
  stats.errors.push(...imported.errors);

  console.info(
    JSON.stringify({
      event: "search_index_sync",
      collection: LEGAL_ENTITIES_COLLECTION,
      ...stats,
    }),
  );
  return stats;
}
