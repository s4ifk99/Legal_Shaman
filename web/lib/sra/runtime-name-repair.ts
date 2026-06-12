import type { DirectorySearchResponse } from "@/lib/legal-search/types";
import type { SearchResult } from "@/lib/legal-search/types";
import { enrichSearchResultForPublic, sraIdFromResult } from "@/lib/legal-search/public-search-result";
import { toLegacyGetResponse } from "@/lib/legal-search/legacy-get-response";
import { enableSearchDebug } from "@/lib/legal-search/config";
import { prisma } from "@/lib/db/prisma";
import { isSraPlaceholderTitle } from "@/lib/search/sra-name-fields";
import {
  extractFirmNameFromSraSearchText,
  isPlaceholderSraBusinessName,
} from "@/lib/search/sra-display";

export type SraDbNameRow = {
  sraId: string;
  displayName: string;
  organisationName: string;
  tradingName: string;
  firmName: string;
  businessName: string;
  searchText: string;
};

export type SraRuntimeNameRepairStats = {
  /** SRA hits whose title matched /^Organisation \d+$/ before repair. */
  sraResultsChecked: number;
  placeholderTitlesResolved: number;
  runtimeTitleResolutionRate: number;
};

export { isSraPlaceholderTitle };

/** Postgres column priority: display_name → organisation_name → trading_name → firm_name. */
export function pickNameFromDbRow(row: SraDbNameRow, sraId: string): string | null {
  for (const c of [
    row.displayName,
    row.organisationName,
    row.tradingName,
    row.firmName,
    row.businessName,
  ]) {
    const t = c?.trim();
    if (t && !isPlaceholderSraBusinessName(t, sraId)) return t;
  }
  return null;
}

export function sraResultNeedsRuntimeTitleRepair(r: SearchResult): boolean {
  if (r.source !== "sra") return false;
  const raw = r.raw as { entityType?: string } | null;
  if (raw?.entityType && raw.entityType !== "sra_organisation") return false;
  const title = (r.displayName ?? r.title).trim();
  return isSraPlaceholderTitle(title);
}

export async function fetchSraNamesByIds(sraIds: string[]): Promise<Map<string, SraDbNameRow>> {
  const unique = [...new Set(sraIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, SraDbNameRow>();
  if (!unique.length || !process.env.DATABASE_URL?.trim()) return out;

  try {
    const rows = await prisma.sraOrganisation.findMany({
      where: { sraId: { in: unique } },
      select: {
        sraId: true,
        displayName: true,
        organisationName: true,
        tradingName: true,
        firmName: true,
        businessName: true,
        searchText: true,
      },
    });
    for (const row of rows) {
      out.set(row.sraId, row);
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "sra_runtime_name_repair_fetch_failed",
        reason: e instanceof Error ? e.message : String(e),
      }),
    );
  }
  return out;
}

function applyDbNameToResult(r: SearchResult, row: SraDbNameRow, repairedName: string): SearchResult {
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  return enrichSearchResultForPublic({
    ...r,
    title: repairedName,
    displayName: repairedName,
    raw: {
      ...raw,
      displayName: row.displayName || repairedName,
      organisationName: row.organisationName,
      tradingName: row.tradingName,
      firmName: row.firmName,
      businessName: repairedName,
      nameRepairedFromDatabase: true,
    },
    debug: r.debug ? { ...r.debug, nameRepairedFromDatabase: true } : r.debug,
  });
}

export async function repairSraSearchResults(
  results: SearchResult[],
): Promise<{ results: SearchResult[]; stats: SraRuntimeNameRepairStats }> {
  const indices: number[] = [];
  const sraIds: string[] = [];

  for (let i = 0; i < results.length; i++) {
    if (!sraResultNeedsRuntimeTitleRepair(results[i]!)) continue;
    indices.push(i);
    sraIds.push(sraIdFromResult(results[i]!));
  }

  const stats: SraRuntimeNameRepairStats = {
    sraResultsChecked: indices.length,
    placeholderTitlesResolved: 0,
    runtimeTitleResolutionRate: 0,
  };

  if (!indices.length) return { results, stats };

  const dbNames = await fetchSraNamesByIds(sraIds);
  const out = results.slice();

  for (let j = 0; j < indices.length; j++) {
    const i = indices[j]!;
    const sraId = sraIds[j]!;
    const prev = out[i]!;
    const row = dbNames.get(sraId);
    if (row) {
      const repaired = pickNameFromDbRow(row, sraId);
      if (repaired) {
        out[i] = applyDbNameToResult(prev, row, repaired);
        stats.placeholderTitlesResolved++;
        continue;
      }
    }

    const searchText = String(
      (prev.raw as { searchText?: string })?.searchText ?? prev.description ?? "",
    );
    const fromText = extractFirmNameFromSraSearchText(searchText, sraId);
    if (fromText && !isSraPlaceholderTitle(fromText)) {
      out[i] = enrichSearchResultForPublic({
        ...prev,
        title: fromText,
        displayName: fromText,
        raw: { ...(prev.raw as object), nameRepairedFromDatabase: false },
      });
      stats.placeholderTitlesResolved++;
    }
  }

  stats.runtimeTitleResolutionRate =
    stats.sraResultsChecked > 0 ? stats.placeholderTitlesResolved / stats.sraResultsChecked : 0;

  if (stats.placeholderTitlesResolved > 0) {
    console.info(JSON.stringify({ event: "sra_runtime_title_repair", ...stats }));
  }

  return { results: out, stats };
}

export async function repairSraOrgDisplayName(
  businessName: string,
  sraId: string,
  searchText: string,
): Promise<{ name: string; nameRepairedFromDatabase: boolean }> {
  if (!isSraPlaceholderTitle(businessName.trim())) {
    return { name: businessName.trim(), nameRepairedFromDatabase: false };
  }
  const map = await fetchSraNamesByIds([sraId]);
  const row = map.get(sraId);
  if (row) {
    const repaired = pickNameFromDbRow(row, sraId);
    if (repaired) return { name: repaired, nameRepairedFromDatabase: true };
  }
  const fromText = extractFirmNameFromSraSearchText(searchText, sraId);
  if (fromText && !isSraPlaceholderTitle(fromText)) {
    return { name: fromText, nameRepairedFromDatabase: false };
  }
  return { name: businessName.trim(), nameRepairedFromDatabase: false };
}

export function mergeSraTitleRepairIntoResponse(
  resp: DirectorySearchResponse & { sraTitleRepair: SraRuntimeNameRepairStats },
): DirectorySearchResponse {
  const stats = resp.sraTitleRepair;
  const degradedModes =
    stats.placeholderTitlesResolved > 0 &&
    !resp.degradedModes.includes("sra_titles_repaired_from_database")
      ? [...resp.degradedModes, "sra_titles_repaired_from_database"]
      : resp.degradedModes;

  const searchDebug = resp.searchDebug
    ? {
        ...resp.searchDebug,
        placeholderTitlesResolved: stats.placeholderTitlesResolved,
        runtimeTitleResolutionRate: stats.runtimeTitleResolutionRate,
        sraPlaceholderTitlesChecked: stats.sraResultsChecked,
      }
    : resp.searchDebug;

  return { ...resp, degradedModes, searchDebug, sraTitleRepair: stats };
}

/** Repair directory/matcher payloads before legacy mapping and API response. */
export async function repairDirectorySearchResponse(
  resp: DirectorySearchResponse,
): Promise<DirectorySearchResponse> {
  const { results: repaired, stats } = await repairSraSearchResults(resp.results);
  let results = repaired;
  if (enableSearchDebug() && resp.searchDebug) {
    const { attachDirectoryDebug } = await import("@/lib/legal-search/search-diagnostics");
    results = attachDirectoryDebug(repaired, resp.parsedQuery);
  }
  const legacyRows = toLegacyGetResponse(results);
  return mergeSraTitleRepairIntoResponse({
    ...resp,
    results,
    legacyRows,
    sraTitleRepair: stats,
  });
}
