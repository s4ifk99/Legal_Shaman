/** Internal / expected flags — hide from end-user copy on search surfaces. */
const USER_HIDDEN_DEGRADED_MODES = new Set([
  "typesense_unreachable",
  "typesense_not_configured",
  "unified_will_degrade_to_legacy",
  "enable_typesense_false",
  "postgres_directory",
  "postgres_sra",
  "postgres_sra_fallback",
  "meilisearch_sra",
  "meilisearch_disabled",
  "legal_entities_empty",
  "legal_entities_collection_missing",
  "vague_query_rescue",
  "sra_titles_repaired_from_database",
]);

export function userFacingDegradedModes(modes: string[]): string[] {
  return [...new Set(modes)].filter((m) => !USER_HIDDEN_DEGRADED_MODES.has(m));
}
