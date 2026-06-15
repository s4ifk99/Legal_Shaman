import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";

function capabilitySlugs(r: SearchResult): string[] {
  const raw = r.raw as {
    capabilities?: string[];
    fundingCapabilities?: string[];
    urgencyCapabilities?: string[];
    accessibilityCapabilities?: string[];
    tribunalCapabilities?: string[];
  } | null;
  if (raw?.capabilities?.length) return raw.capabilities;
  return [
    ...(raw?.fundingCapabilities ?? []),
    ...(raw?.urgencyCapabilities ?? []),
    ...(raw?.accessibilityCapabilities ?? []),
    ...(raw?.tribunalCapabilities ?? []),
  ];
}

function approvedCapabilitiesText(r: SearchResult): string {
  const raw = r.raw as {
    capabilities?: string[];
    tribunalCapabilities?: string[];
    enrichmentStatus?: string;
  } | null;
  const status = raw?.enrichmentStatus;
  if (status !== "approved" && status !== "auto_approved") return "";
  return [...(raw?.capabilities ?? []), ...(raw?.tribunalCapabilities ?? [])].join(" ");
}

/** Build the document side of a query–document pair for cross-encoder reranking. */
export function buildOpenRerankerDocumentText(
  result: SearchResult,
  parsed: ParsedQuery,
): string {
  const raw = result.raw as {
    relatedPracticeAreas?: string[];
    taxonomyAliases?: string[];
    entityType?: string;
  } | null;

  const parts = [
    result.title,
    result.practiceAreas.join(" "),
    result.categories.join(" "),
    result.description ?? "",
    `source: ${result.source}`,
    result.location?.city ? `city: ${result.location.city}` : "",
    result.location?.postcode ? `postcode: ${result.location.postcode}` : "",
    approvedCapabilitiesText(result) || capabilitySlugs(result).join(" "),
    raw?.relatedPracticeAreas?.slice(0, 6).join(" "),
    raw?.taxonomyAliases?.slice(0, 8).join(" "),
    parsed.taxonomyPrimaryLabel ?? "",
  ];

  return parts.filter(Boolean).join("\n").slice(0, 1500);
}

/** Query text: user query + expanded taxonomy retrieval string. */
export function buildOpenRerankerQueryText(
  userQuery: string,
  parsed: ParsedQuery,
): string {
  const expanded = parsed.expandedSearchText?.trim();
  if (expanded && expanded.length > userQuery.trim().length) {
    return `${userQuery.trim()}\n${expanded}`.slice(0, 1200);
  }
  return userQuery.trim().slice(0, 1200);
}
