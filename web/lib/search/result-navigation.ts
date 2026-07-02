import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";

export function entityIdFromLegacyRow(row: LegacyGetRow): string {
  if (row.kind === "adlGroup") return row.firmGroupId;
  return row.id;
}

export function searchUrlForListingName(businessName: string, entityId?: string): string {
  const params = new URLSearchParams({ q: businessName.trim() });
  if (entityId?.trim()) params.set("entity", entityId.trim());
  return `/search?${params.toString()}`;
}

export function searchUrlForEntity(entityId: string, businessName: string): string {
  return searchUrlForListingName(businessName, entityId);
}
