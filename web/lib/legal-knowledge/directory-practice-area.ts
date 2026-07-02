import type { LegalIssueResolution } from "@/lib/legal/taxonomy";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";

/** Practice-area slug for directory / Typesense filtering (prefer specific taxonomy slug). */
export function directoryPracticeAreaFromQuery(
  query: string,
  resolution?: LegalIssueResolution | null,
): string | undefined {
  const resolved = resolution ?? resolveLegalIssueFromQuery(query);

  if (resolved?.taxonomySlug) return resolved.taxonomySlug;
  return resolved?.matcherSlug ?? undefined;
}
