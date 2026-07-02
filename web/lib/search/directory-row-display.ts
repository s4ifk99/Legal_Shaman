import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";

export function stableDirectoryRowKey(row: LegacyGetRow): string {
  if (row.kind === "adlGroup") return `adlg:${row.firmGroupId}`;
  return `adl:${row.id}`;
}

export function collapsedDirectorySummary(row: LegacyGetRow): string {
  if (row.kind === "adlGroup") {
    return `${row.locations.length} office${row.locations.length === 1 ? "" : "s"} · Legal aid provider`;
  }
  const location = [row.city, row.postcode].filter(Boolean).join(", ");
  if (row.kind === "adl" && row.sourceType === "sra") {
    const areas = row.practiceAreas?.slice(0, 2).join(", ");
    return [areas, location].filter(Boolean).join(" · ");
  }
  return [row.description.slice(0, 120), location].filter(Boolean).join(" · ");
}
