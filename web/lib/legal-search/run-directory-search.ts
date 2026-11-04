import "server-only";

import type { DirectorySearchParams, DirectorySearchResponse } from "@/lib/legal-search/types";
import { usePostgresDirectorySearch } from "@/lib/legal-search/config";
import { runDirectorySearchLegacy } from "@/lib/legal-search/run-directory-search-legacy";
import { runTypesenseDirectorySearch } from "@/lib/legal-search/typesense-directory-search";
import { ensureSearchStartupLogged } from "@/lib/legal-search/search-startup";
import { repairDirectorySearchResponse } from "@/lib/sra/runtime-name-repair";
import { hydrateSraPracticeAreasOnResults } from "@/lib/legal-search/hydrate-sra-practice-areas";
import { toLegacyGetResponse } from "@/lib/legal-search/legacy-get-response";
import { attachProviderEvidence } from "@/lib/legal-search/evidence/attach-provider-evidence";

/**
 * Unified directory search entrypoint for GET /api/search and /search page.
 * V1 production: Postgres FTS + lexical listings. Local dev: Typesense when enabled.
 */
export async function runDirectorySearch(
  params: DirectorySearchParams,
): Promise<DirectorySearchResponse> {
  await ensureSearchStartupLogged();
  const response = usePostgresDirectorySearch()
    ? await runDirectorySearchLegacy(params)
    : await runTypesenseDirectorySearch(params);

  const hydratedResults = await hydrateSraPracticeAreasOnResults(response.results);
  const repaired = await repairDirectorySearchResponse({
    ...response,
    results: hydratedResults,
    legacyRows: toLegacyGetResponse(hydratedResults),
  });
  return {
    ...repaired,
    results: await attachProviderEvidence(repaired.results),
  };
}
