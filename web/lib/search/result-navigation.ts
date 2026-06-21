import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";

export function entityIdFromLegacyRow(row: LegacyGetRow): string {
  if (row.kind === "adlGroup") return row.firmGroupId;
  return row.id;
}

export function searchUrlForListingName(businessName: string): string {
  return `/search?q=${encodeURIComponent(businessName.trim())}`;
}
