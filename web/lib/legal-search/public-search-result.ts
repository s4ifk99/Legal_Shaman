import type { SearchResult } from "@/lib/legal-search/types";
import { sourceProvenanceLabel } from "@/lib/legal-search/orchestration/source-provenance";
import { pickSraIndexTitle } from "@/lib/search/sra-name-fields";
import {
  formatPhoneForDisplay,
  isPlaceholderSraBusinessName,
} from "@/lib/search/sra-display";

const INTERNAL_ID_TITLE = /^(sra:|legal_aid:|curated:)/i;

export function sraIdFromResult(r: SearchResult): string {
  const raw = r.raw as { sraId?: string; exactSraId?: string } | null;
  return String(raw?.sraId ?? raw?.exactSraId ?? r.id.replace(/^sra:/, "")).trim();
}

/** User-facing title — never an internal id or bare organisation number. */
export function publicResultTitle(r: SearchResult): string {
  const raw = r.raw as {
    entityType?: string;
    searchText?: string;
    description?: string;
    displayName?: string;
    tradingName?: string;
    organisationName?: string;
    firmName?: string;
  } | null;
  const entityType = String(raw?.entityType ?? "");
  const isSra = r.source === "sra" || entityType === "sra_organisation";

  if (isSra) {
    const sraId = sraIdFromResult(r);
    const searchText = String(raw?.searchText ?? raw?.description ?? r.description ?? "");
    return pickSraIndexTitle(sraId, searchText, {
      displayName: r.displayName ?? raw?.displayName,
      tradingName: raw?.tradingName,
      organisationName: raw?.organisationName,
      firmName: raw?.firmName,
      businessName: r.title,
    });
  }

  const title = (r.displayName ?? r.title).trim();
  if (!title || INTERNAL_ID_TITLE.test(title)) {
    return r.practiceAreas[0] ? `${r.practiceAreas[0]} provider` : "Legal services provider";
  }
  return title;
}

export function buildLocationLabel(r: SearchResult): string | undefined {
  const parts = [r.location?.city, r.location?.postcode].filter(Boolean);
  if (parts.length) return parts.join(", ");
  const addr = r.address?.trim();
  return addr || undefined;
}

export function entityTypeFromResult(r: SearchResult): string {
  const raw = r.raw as { entityType?: string } | null;
  if (raw?.entityType) return String(raw.entityType);
  switch (r.source) {
    case "sra":
      return "sra_organisation";
    case "legal_aid":
      return "legal_aid_provider";
    case "lawyer":
      return "lawyer";
    case "firm":
      return "firm";
    default:
      return "curated_listing";
  }
}

export function contactPageUrlForResult(r: SearchResult): string | undefined {
  const raw = r.raw as { contactPageUrl?: string; profileUrl?: string } | null;
  return (
    r.contactPageUrl?.trim() ||
    raw?.contactPageUrl?.trim() ||
    raw?.profileUrl?.trim() ||
    r.url?.trim() ||
    undefined
  );
}

export function websiteUrlForResult(r: SearchResult): string | undefined {
  const site = r.contact?.website?.trim();
  if (site && !site.includes("sra.org.uk/consumers")) return site;
  return undefined;
}

export function phoneForDisplay(r: SearchResult): string | undefined {
  return r.contact?.phone?.trim() || undefined;
}

export function emailForDisplay(r: SearchResult): string | undefined {
  return r.contact?.email?.trim() || undefined;
}

/** Populate API-facing display fields on SearchResult. */
export function enrichSearchResultForPublic(r: SearchResult): SearchResult {
  const title = publicResultTitle(r);
  const isSra = r.source === "sra" || entityTypeFromResult(r) === "sra_organisation";
  const sraOrganisationId = isSra ? sraIdFromResult(r) || undefined : undefined;

  return {
    ...r,
    title,
    displayName: title,
    sourceLabel: sourceProvenanceLabel(r),
    entityType: entityTypeFromResult(r),
    locationLabel: buildLocationLabel(r),
    address: r.address ?? (r.raw as { address?: string })?.address,
    sraOrganisationId,
    contactPageUrl: contactPageUrlForResult(r),
  };
}

export { formatPhoneForDisplay, isPlaceholderSraBusinessName };
