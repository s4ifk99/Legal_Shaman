import "server-only";

import type { DirectorySearchParams, DirectorySearchResponse } from "@/lib/legal-search/types";
import { usePostgresDirectorySearch } from "@/lib/legal-search/config";
import { runDirectorySearchLegacy } from "@/lib/legal-search/run-directory-search-legacy";
import { runTypesenseDirectorySearch } from "@/lib/legal-search/typesense-directory-search";
import { ensureSearchStartupLogged } from "@/lib/legal-search/search-startup";
import { repairDirectorySearchResponse } from "@/lib/sra/runtime-name-repair";

/**
 * Unified directory search entrypoint for GET /api/search and /search page.
 * V1 production: Postgres FTS + lexical listings. Local dev: Typesense when enabled.
 */
export async function runDirectorySearch(
  params: DirectorySearchParams,
): Promise<DirectorySearchResponse> {
  await ensureSearchStartupLogged();
  if (usePostgresDirectorySearch()) {
    return repairDirectorySearchResponse(await runDirectorySearchLegacy(params));
  }
  return repairDirectorySearchResponse(await runTypesenseDirectorySearch(params));
}
