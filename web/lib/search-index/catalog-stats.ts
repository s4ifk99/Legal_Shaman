import { prisma } from "@/lib/db/prisma";
import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import probonoData from "@/data/probono-sources.json";
import { readSraSyncState } from "@/lib/sra/sync-state";

export type CatalogStats = {
  sraPostgresCount: number | null;
  sraTypesenseCount: number | null;
  legalAidProviderCount: number | null;
  proBonoSourceCount: number;
  proBonoIndexedEstimate: number | null;
  legalEntitiesTotal: number | null;
  lastIndexBuildAt: string | null;
  sraSync: Awaited<ReturnType<typeof readSraSyncState>>;
};

async function countTypesenseFilter(filterBy: string): Promise<number | null> {
  const client = buildTypesenseListingsClientFromEnv();
  if (!client) return null;
  try {
    const res = await client
      .collections(LEGAL_ENTITIES_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "title",
        filter_by: filterBy,
        per_page: 0,
      });
    return (res as { found?: number }).found ?? null;
  } catch {
    return null;
  }
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const proBonoSourceCount = (probonoData as { sources: unknown[] }).sources?.length ?? 0;
  const sraSync = await readSraSyncState();

  let sraPostgresCount: number | null = null;
  try {
    sraPostgresCount = await prisma.sraOrganisation.count();
  } catch {
    sraPostgresCount = null;
  }

  const client = buildTypesenseListingsClientFromEnv();
  let legalEntitiesTotal: number | null = null;
  if (client) {
    try {
      const col = await client.collections(LEGAL_ENTITIES_COLLECTION).retrieve();
      legalEntitiesTotal = (col as { num_documents?: number }).num_documents ?? null;
    } catch {
      legalEntitiesTotal = null;
    }
  }

  const [sraTypesenseCount, legalAidProviderCount, proBonoIndexedEstimate] = await Promise.all([
    countTypesenseFilter("entityType:=`sra_organisation`"),
    countTypesenseFilter("entityType:=`legal_aid_provider`"),
    countTypesenseFilter(
      "entityType:=[`pro_bono_organisation`,`law_centre`,`advice_charity`,`university_law_clinic`]",
    ),
  ]);

  return {
    sraPostgresCount,
    sraTypesenseCount,
    legalAidProviderCount,
    proBonoSourceCount,
    proBonoIndexedEstimate,
    legalEntitiesTotal,
    lastIndexBuildAt: process.env.SEARCH_INDEX_BUILT_AT ?? null,
    sraSync,
  };
}
