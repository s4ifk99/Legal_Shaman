import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import {
  buildCuratedDocuments,
  buildLegalAidDocuments,
  buildLawyerDocuments,
  buildSraDocuments,
  buildProBonoDocuments,
  documentToTypesenseRecord,
} from "@/lib/search-index/build-legal-entity-doc";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { ensureLegalEntitiesCollection } from "@/lib/search-index/typesense-legal-entities-index";
import { applyProviderIntelligence, loadEnrichmentCache } from "@/lib/search-index/apply-provider-intelligence";
import { enrichLegalEntityForIndex } from "@/lib/search-index/enrich-legal-entity-index";
import type { IndexSource, LegalEntityDocument, SyncStats } from "@/lib/search-index/types";

const CHUNK = 200;

async function collectDocuments(source: IndexSource): Promise<LegalEntityDocument[]> {
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

export async function syncLegalEntitiesToTypesense(
  source: IndexSource = "all",
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
  const raw = await collectDocuments(source);
  const docs: LegalEntityDocument[] = [];
  for (const d of raw) {
    docs.push(enrichLegalEntityForIndex(await applyProviderIntelligence(d)));
  }
  stats.documentsBuilt = docs.length;

  for (const d of docs) {
    if (d.locationPoint) stats.geocoded++;
    else stats.skippedNoCoords++;
  }

  for (let i = 0; i < docs.length; i += CHUNK) {
    const chunk = docs.slice(i, i + CHUNK).map(documentToTypesenseRecord);
    try {
      const importRes = (await client
        .collections(LEGAL_ENTITIES_COLLECTION)
        .documents()
        .import(chunk, { action: "upsert" })) as { success?: boolean; error?: string }[];
      let ok = 0;
      for (const line of importRes) {
        if (line.success) ok++;
        else stats.errors.push(line.error ?? "import line failed");
      }
      stats.documentsUpserted += ok;
    } catch (e) {
      stats.errors.push(String(e));
    }
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
