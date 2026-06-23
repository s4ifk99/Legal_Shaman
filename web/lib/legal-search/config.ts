/**
 * Feature flags for the unified legal search engine.
 * All default to safe/off or "inherit existing behaviour" unless noted.
 *
 * V1 directory search:
 * - Production / Vercel preview → Postgres full-text (Neon `sra_organisations` + lexical listings)
 * - Local dev → Typesense `legal_entities` when `ENABLE_TYPESENSE_UNIFIED=true`
 *
 * Override with `DIRECTORY_SEARCH_BACKEND=postgres|typesense`.
 */

export type DirectorySearchBackend = "postgres" | "typesense";

export function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return defaultValue;
  return v === "1" || v === "true" || v === "yes";
}

/** When true, GET /api/search runs merge + ranking + optional SRA via legal-search. Default false preserves legacy-only path unless set. */
export function enableUnifiedDirectory(): boolean {
  return envBool("ENABLE_UNIFIED_DIRECTORY", false);
}

export function enableLlmSearch(): boolean {
  return envBool("ENABLE_LLM_SEARCH", true);
}

export function enableVectorSearch(): boolean {
  return envBool("ENABLE_VECTOR_SEARCH", true);
}

export function enableMeilisearch(): boolean {
  return envBool("ENABLE_MEILISEARCH", true);
}

export function enableTypesense(): boolean {
  return envBool("ENABLE_TYPESENSE", true);
}

/** Rich search diagnostics (parsed query, scores, retrieval sources). Off in production unless flag is set. */
export function enableSearchDebug(): boolean {
  return envBool("ENABLE_SEARCH_DEBUG", false) || process.env.NODE_ENV === "development";
}

/** V1: production uses Postgres FTS; local dev defaults to Typesense. */
export function directorySearchBackend(): DirectorySearchBackend {
  const explicit = process.env.DIRECTORY_SEARCH_BACKEND?.trim().toLowerCase();
  if (explicit === "postgres" || explicit === "typesense") {
    return explicit;
  }
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv === "production" || vercelEnv === "preview") {
    return "postgres";
  }
  return "typesense";
}

export function usePostgresDirectorySearch(): boolean {
  return directorySearchBackend() === "postgres";
}

/** Typesense `legal_entities` as primary directory + map retrieval (local dev). */
export function enableTypesenseUnified(): boolean {
  if (usePostgresDirectorySearch()) return false;
  return envBool("ENABLE_TYPESENSE_UNIFIED", false);
}

export function enableMapSearch(): boolean {
  return envBool("ENABLE_MAP_SEARCH", true);
}

export function enableGeocoding(): boolean {
  return envBool("ENABLE_GEOCODING", true);
}

/** When true, matcher may call external geocoders on cache miss (default off). */
export function enableGeocodingRuntime(): boolean {
  return envBool("ENABLE_GEOCODING_RUNTIME", false);
}

export function enableResultClustering(): boolean {
  return envBool("ENABLE_RESULT_CLUSTERING", true);
}

/** Cross-encoder open reranker (BGE / Qwen via HF inference). Off by default. */
export function enableOpenReranker(): boolean {
  return envBool("ENABLE_OPEN_RERANKER", false);
}
