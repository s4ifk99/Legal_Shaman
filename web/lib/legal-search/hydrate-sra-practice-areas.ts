import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { SearchResult } from "@/lib/legal-search/types";
import { sraIdFromResult } from "@/lib/legal-search/public-search-result";
import { resolveSraPracticeAreasForDisplay } from "@/lib/search/sra-practice-areas";

function rawRecord(result: SearchResult): Record<string, unknown> {
  return result.raw && typeof result.raw === "object" ? (result.raw as Record<string, unknown>) : {};
}

function practiceAreaSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (labels: string[]) =>
    [...new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean))].sort();
  const na = norm(a);
  const nb = norm(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

/**
 * Backfill practice areas on SRA directory hits from Postgres register + text projection.
 * Many indexed firms have null `work_area` but retain areas in `raw_payload` / `search_text`.
 */
export async function hydrateSraPracticeAreasOnResults(
  results: SearchResult[],
): Promise<SearchResult[]> {
  const sraResults = results.filter((r) => r.source === "sra");
  if (sraResults.length === 0) return results;

  const sraIds = [
    ...new Set(sraResults.map((r) => sraIdFromResult(r)).filter((id) => id.length > 0)),
  ];
  if (sraIds.length === 0) return results;

  const orgs = await prisma.sraOrganisation.findMany({
    where: { sraId: { in: sraIds } },
    select: {
      sraId: true,
      businessName: true,
      displayName: true,
      searchText: true,
      workArea: true,
      rawPayload: true,
    },
  });
  const bySraId = new Map(orgs.map((o) => [o.sraId, o]));

  return results.map((result) => {
    if (result.source !== "sra") return result;

    const sraId = sraIdFromResult(result);
    const org = bySraId.get(sraId);
    const raw = rawRecord(result);
    const searchText = String(org?.searchText ?? raw.searchText ?? result.description ?? "");
    const organisationName =
      result.displayName ?? result.title ?? org?.displayName ?? org?.businessName ?? "";
    const enrichmentText = Array.isArray(raw.capabilities)
      ? (raw.capabilities as string[]).join(" ")
      : undefined;

    const practiceAreas = resolveSraPracticeAreasForDisplay({
      organisationName,
      searchText,
      description: result.description,
      workArea: org?.workArea ?? raw.workArea,
      rawPayload: org?.rawPayload ?? raw.rawPayload,
      enrichmentText,
    });

    if (practiceAreas.length === 0 && result.practiceAreas.length === 0) {
      return result;
    }

    if (practiceAreaSetsEqual(practiceAreas, result.practiceAreas)) {
      return result;
    }

    return { ...result, practiceAreas };
  });
}
