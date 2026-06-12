import type { SraOrganisation } from "@prisma/client";

import { extractFirmNameFromSraSearchText, isPlaceholderSraBusinessName } from "@/lib/search/sra-display";
import { isAddressLikeName, isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type SraTitleSourceInput = {
  sraId: string;
  searchText: string;
  orgDisplayName: string;
  organisationName: string;
  tradingName: string;
  firmName: string;
  businessName: string;
  firmBusinessName?: string | null;
  rawPayload?: unknown;
};

export type SraTitleResolution = {
  title: string;
  reason:
    | "firm_business_name"
    | "organisation_name"
    | "trading_name"
    | "firm_name_column"
    | "business_name"
    | "search_text"
    | "display_name"
    | "placeholder_fallback";
};

function usableName(name: string | null | undefined, sraId: string): string | null {
  const t = name?.trim();
  if (!t) return null;
  if (isPlaceholderSraBusinessName(t, sraId)) return null;
  if (isPlaceholderSraDisplayName(t, sraId)) return null;
  if (isAddressLikeName(t)) return null;
  return t;
}

function practiceNameFromPayload(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const v = o.PracticeName ?? o.practiceName ?? o.AuthorisedName ?? o.authorisedName;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Canonical SRA index title — firm.name and PracticeName beat stale placeholder display_name. */
export function chooseSraIndexTitle(input: SraTitleSourceInput): SraTitleResolution {
  const { sraId, searchText } = input;

  const firmName = usableName(input.firmBusinessName, sraId);
  if (firmName) return { title: firmName, reason: "firm_business_name" };

  const orgName =
    usableName(input.organisationName, sraId) ??
    usableName(practiceNameFromPayload(input.rawPayload), sraId);
  if (orgName) return { title: orgName, reason: "organisation_name" };

  const trading = usableName(input.tradingName, sraId);
  if (trading) return { title: trading, reason: "trading_name" };

  const firmCol = usableName(input.firmName, sraId);
  if (firmCol) return { title: firmCol, reason: "firm_name_column" };

  const business = usableName(input.businessName, sraId);
  if (business) return { title: business, reason: "business_name" };

  const fromText = extractFirmNameFromSraSearchText(searchText, sraId);
  if (fromText && usableName(fromText, sraId)) {
    return { title: fromText, reason: "search_text" };
  }

  const display = usableName(input.orgDisplayName, sraId);
  if (display) return { title: display, reason: "display_name" };

  return { title: `SRA organisation ${sraId}`, reason: "placeholder_fallback" };
}

export function sraTitleSourceInputFromOrg(
  org: Pick<
    SraOrganisation,
    | "sraId"
    | "displayName"
    | "organisationName"
    | "tradingName"
    | "firmName"
    | "businessName"
    | "searchText"
    | "rawPayload"
  >,
  firmBusinessName?: string | null,
): SraTitleSourceInput {
  return {
    sraId: org.sraId,
    searchText: org.searchText || org.businessName,
    orgDisplayName: org.displayName,
    organisationName: org.organisationName,
    tradingName: org.tradingName,
    firmName: org.firmName,
    businessName: org.businessName,
    firmBusinessName,
    rawPayload: org.rawPayload,
  };
}

export type SraTitleAuditRow = {
  entityId: string;
  sraOrganisationDisplayName: string;
  firmBusinessName: string | null;
  chosenIndexTitle: string;
  reason: string;
};

export function auditSraTitleRow(
  org: Pick<
    SraOrganisation,
    | "sraId"
    | "displayName"
    | "organisationName"
    | "tradingName"
    | "firmName"
    | "businessName"
    | "searchText"
    | "rawPayload"
  >,
  firmBusinessName?: string | null,
): SraTitleAuditRow {
  const resolution = chooseSraIndexTitle(sraTitleSourceInputFromOrg(org, firmBusinessName));
  return {
    entityId: `sra:${org.sraId}`,
    sraOrganisationDisplayName: org.displayName,
    firmBusinessName: firmBusinessName?.trim() || null,
    chosenIndexTitle: resolution.title,
    reason: resolution.reason,
  };
}

/** Minimal Typesense partial update for SRA display titles only (title fields; no searchText re-tokenization). */
export function buildSraNamePatchRecord(args: {
  entityId: string;
  title: string;
  includeSearchText?: boolean;
  searchText?: string;
}): Record<string, unknown> {
  const title = args.title.trim();
  const patch: Record<string, unknown> = {
    id: args.entityId,
    title,
    displayName: title,
    exactTitle: title,
  };
  if (args.includeSearchText) {
    const st = args.searchText?.trim();
    if (st) patch.searchText = st.slice(0, 500);
  }
  return patch;
}

export const SRA_NAME_PATCH_FIELD_DENylist = [
  "expandedSearchText",
  "capabilitySearchText",
  "legalSearchText",
  "provenanceSearchText",
  "geoSearchText",
  "userSearchText",
  "description",
  "practiceAreas",
  "practiceAreaSlugs",
] as const;

export function assertMinimalSraNamePatch(patch: Record<string, unknown>): void {
  for (const key of SRA_NAME_PATCH_FIELD_DENylist) {
    if (key in patch) {
      throw new Error(`SRA name patch must not include ${key}`);
    }
  }
}

export function estimatePatchBytes(patch: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(patch), "utf8");
}
