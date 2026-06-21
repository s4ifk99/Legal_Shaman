import type { SearchResultSource } from "@/lib/search-events/types";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";

export type BookmarkKey = {
  entityId: string;
  resultSource: SearchResultSource;
};

export type BookmarkRecord = BookmarkKey & {
  id: string;
  businessName: string;
  createdAt: string;
};

export type BookmarkInput = BookmarkKey & {
  businessName: string;
};

export function bookmarkKeyString(key: BookmarkKey): string {
  return `${key.resultSource}:${key.entityId}`;
}

export function bookmarkMetaFromLegacyRow(row: LegacyGetRow): BookmarkInput {
  if (row.kind === "adlGroup") {
    return {
      entityId: row.firmGroupId,
      resultSource: "legal_aid",
      businessName: row.businessName,
    };
  }
  if (row.kind === "adl" && row.sourceType === "sra") {
    return {
      entityId: row.id,
      resultSource: "sra",
      businessName: row.businessName,
    };
  }
  if (row.kind === "adl" && row.isLegalAid) {
    return {
      entityId: row.id,
      resultSource: "legal_aid",
      businessName: row.businessName,
    };
  }
  return {
    entityId: row.id,
    resultSource: "curated_listing",
    businessName: row.businessName,
  };
}
