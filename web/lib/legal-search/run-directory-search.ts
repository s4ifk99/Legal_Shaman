import "server-only";

import type { DirectorySearchParams, DirectorySearchResponse } from "@/lib/legal-search/types";
import { runTypesenseDirectorySearch } from "@/lib/legal-search/typesense-directory-search";
import { ensureSearchStartupLogged } from "@/lib/legal-search/search-startup";
import { repairDirectorySearchResponse } from "@/lib/sra/runtime-name-repair";

/**
 * Unified directory search entrypoint for GET /api/search and /search page.
 * Delegates to Typesense `legal_entities` when enabled, else legacy hybrid path.
 */
export async function runDirectorySearch(
  params: DirectorySearchParams,
): Promise<DirectorySearchResponse> {
  await ensureSearchStartupLogged();
  const resp = await runTypesenseDirectorySearch(params);
  return repairDirectorySearchResponse(resp);
}
