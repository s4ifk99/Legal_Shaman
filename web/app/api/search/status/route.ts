import { NextResponse } from "next/server";
import { loadEmbeddingsBundle } from "@/lib/embeddings-store";
import { DIRECTORY_LISTINGS_COLLECTION } from "@/lib/search/typesense-listings-config";
import { typesenseListingsConfigured } from "@/lib/search/typesense-listings";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import {
  enableTypesense,
  enableTypesenseUnified,
  enableVectorSearch,
} from "@/lib/legal-search/config";
import { getSearchStackStatus } from "@/lib/legal-search/search-startup";
import { getCatalogStats } from "@/lib/search-index/catalog-stats";

export const runtime = "nodejs";

/** Operator-facing check: embeddings + Typesense collections (no secrets exposed). */
export async function GET() {
  const bundle = loadEmbeddingsBundle();
  const stack = await getSearchStackStatus();
  const catalog = await getCatalogStats();

  return NextResponse.json({
    embeddingsLoaded: Boolean(bundle),
    embeddingModelId: bundle?.modelId ?? null,
    embeddingDim: bundle?.dim ?? null,
    listingVectorCount: bundle?.ids.length ?? 0,
    hfTokenConfigured: Boolean(process.env.HF_TOKEN?.trim()),
    typesenseListingsConfigured: typesenseListingsConfigured(),
    typesenseListingsReachable: stack.typesenseReachable,
    directoryListingsCollection: DIRECTORY_LISTINGS_COLLECTION,
    enableTypesense: enableTypesense(),
    enableTypesenseUnified: enableTypesenseUnified(),
    enableVectorSearch: enableVectorSearch(),
    activeDirectoryEngine: stack.activeDirectoryEngine,
    degradedModeWarnings: stack.degradedModeWarnings,
    legalEntitiesCollection: LEGAL_ENTITIES_COLLECTION,
    legalEntitiesCollectionExists: stack.legalEntitiesCollectionExists,
    legalEntitiesDocumentCount: stack.legalEntitiesDocumentCount,
    typesenseVersion: stack.typesenseVersion,
    sraPostgresCount: catalog.sraPostgresCount,
    sraTypesenseCount: catalog.sraTypesenseCount,
    legalAidProviderCount: catalog.legalAidProviderCount,
    proBonoSourceCount: catalog.proBonoSourceCount,
    proBonoIndexedCount: catalog.proBonoIndexedEstimate,
    legalEntitiesTotalCount: catalog.legalEntitiesTotal,
    lastIndexBuildAt: catalog.lastIndexBuildAt,
    sraLastSyncAt: catalog.sraSync.lastSuccessAt,
    sraSyncErrors: catalog.sraSync.errors,
    sraApiConfigured: catalog.sraSync.apiConfigured,
  });
}
