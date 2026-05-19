import "server-only";

import { runDirectorySearch } from "@/lib/legal-search/run-directory-search";
import type { DirectorySearchResponse } from "@/lib/legal-search/types";

/** Admin-only: run directory search with full debug + ranking stage snapshots. */
export async function runRankingProbe(
  query: string,
  limit = 20,
): Promise<DirectorySearchResponse> {
  return runDirectorySearch({
    query,
    limit,
    semantic: false,
    forceSearchDebug: true,
    includeRankingStages: true,
  });
}
