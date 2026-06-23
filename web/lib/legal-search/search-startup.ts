import { buildTypesenseListingsClientFromEnv } from "@/lib/search/typesense-listings-client";
import { LEGAL_ENTITIES_COLLECTION } from "@/lib/search-index/config";
import { typesenseServerHealth } from "@/lib/search-index/typesense-legal-entities-index";
import {
  directorySearchBackend,
  enableTypesense,
  enableTypesenseUnified,
  enableVectorSearch,
  usePostgresDirectorySearch,
} from "@/lib/legal-search/config";

function postgresSraConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export type SearchStackStatus = {
  typesenseReachable: boolean;
  typesenseVersion: string | null;
  legalEntitiesCollectionExists: boolean;
  legalEntitiesDocumentCount: number | null;
  directorySearchBackend: "postgres" | "typesense";
  enableTypesenseUnified: boolean;
  enableTypesense: boolean;
  enableVectorSearch: boolean;
  activeDirectoryEngine: "postgres" | "typesense_unified" | "legacy";
  degradedModeWarnings: string[];
};

let startupLogged = false;

/** Probe Typesense + flags (no secrets). Safe for API routes and CLI. */
export async function getSearchStackStatus(): Promise<SearchStackStatus> {
  const warnings: string[] = [];
  const unified = enableTypesenseUnified();
  const tsFlag = enableTypesense();

  let typesenseReachable = false;
  let typesenseVersion: string | null = null;
  let legalEntitiesCollectionExists = false;
  let legalEntitiesDocumentCount: number | null = null;

  const client = buildTypesenseListingsClientFromEnv();
  if (!client) {
    warnings.push("typesense_not_configured");
  } else {
    const health = await typesenseServerHealth(client);
    typesenseReachable = health.ok;
    typesenseVersion = health.version ?? null;
    if (!health.ok) warnings.push("typesense_unreachable");
    if (health.ok) {
      try {
        const col = await client.collections(LEGAL_ENTITIES_COLLECTION).retrieve();
        legalEntitiesCollectionExists = true;
        const n = (col as { num_documents?: number }).num_documents;
        legalEntitiesDocumentCount = typeof n === "number" ? n : null;
        if (legalEntitiesDocumentCount === 0) warnings.push("legal_entities_empty");
      } catch {
        warnings.push("legal_entities_collection_missing");
      }
    }
  }

  if (unified && !typesenseReachable) {
    warnings.push("unified_will_degrade_to_legacy");
  }
  if (!tsFlag) warnings.push("enable_typesense_false");

  const backend = directorySearchBackend();
  let activeDirectoryEngine: SearchStackStatus["activeDirectoryEngine"];
  if (usePostgresDirectorySearch()) {
    activeDirectoryEngine = "postgres";
    if (!postgresSraConfigured()) warnings.push("database_url_missing");
  } else {
    activeDirectoryEngine =
      unified && typesenseReachable && legalEntitiesCollectionExists
        ? "typesense_unified"
        : "legacy";
  }

  return {
    typesenseReachable,
    typesenseVersion,
    legalEntitiesCollectionExists,
    legalEntitiesDocumentCount,
    directorySearchBackend: backend,
    enableTypesenseUnified: unified,
    enableTypesense: tsFlag,
    enableVectorSearch: enableVectorSearch(),
    activeDirectoryEngine,
    degradedModeWarnings: warnings,
  };
}

/** Log stack status once per process (first search request or explicit call). */
export async function ensureSearchStartupLogged(): Promise<SearchStackStatus> {
  const status = await getSearchStackStatus();
  if (!startupLogged) {
    startupLogged = true;
    console.info(
      JSON.stringify({
        event: "search_stack_startup",
        ...status,
      }),
    );
  }
  return status;
}
