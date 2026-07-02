import type { SearchResult, SearchSource } from "@/lib/legal-search/types";
import { emptyScores } from "@/lib/legal-search/ranking";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import { fetchAllListings } from "@/lib/data";
import type { UnifiedSearchHit } from "@/lib/search/unified-search";
import { fromUnifiedHit } from "@/lib/legal-search/adapters/listing-adapter";
import type { ParsedQuery } from "@/lib/legal-search/types";
import { sanitiseContactForDisplay } from "@/lib/provider-intelligence/provider-capability-ranker";
import { enrichSearchResultForPublic } from "@/lib/legal-search/public-search-result";
import {
  extractPhoneFromSraSearchText,
  resolveSraDisplayName,
} from "@/lib/search/sra-display";
import { resolveSraPracticeAreasForDisplay } from "@/lib/search/sra-practice-areas";

function entityTypeToSource(entityType: string, source: string): SearchSource {
  if (entityType === "lawyer") return "lawyer";
  if (entityType === "firm") return "firm";
  if (entityType === "sra_organisation") return "sra";
  if (entityType === "legal_aid_provider" || entityType === "law_centre") return "legal_aid";
  if (
    entityType === "pro_bono_organisation" ||
    entityType === "advice_charity" ||
    entityType === "university_law_clinic"
  ) {
    return "curated_listing";
  }
  return source === "legal_aid" || source === "probono" ? "legal_aid" : "curated_listing";
}

/** Map Typesense hit document to canonical SearchResult. */
export function legalEntityDocToSearchResult(
  doc: Record<string, unknown>,
  parsed: ParsedQuery,
  textMatch?: number,
): SearchResult {
  const entityType = String(doc.entityType ?? "");
  const source = entityTypeToSource(entityType, String(doc.source ?? ""));
  const id = String(doc.id ?? "");
  const lat = Array.isArray(doc.locationPoint)
    ? Number((doc.locationPoint as number[])[0])
    : typeof doc.latitude === "number"
      ? doc.latitude
      : undefined;
  const lng = Array.isArray(doc.locationPoint)
    ? Number((doc.locationPoint as number[])[1])
    : typeof doc.longitude === "number"
      ? doc.longitude
      : undefined;

  const practiceAreas = Array.isArray(doc.practiceAreas)
    ? (doc.practiceAreas as string[])
    : [];
  const relatedPracticeAreas = Array.isArray(doc.relatedPracticeAreas)
    ? (doc.relatedPracticeAreas as string[])
    : [];
  const practiceAreaSlugs = Array.isArray(doc.practiceAreaSlugs)
    ? (doc.practiceAreaSlugs as string[])
    : [];

  const isSra = entityType === "sra_organisation";
  const mergedPracticeAreas = isSra
    ? resolveSraPracticeAreasForDisplay({
        organisationName: String(doc.displayName ?? doc.title ?? ""),
        searchText: String(doc.searchText ?? doc.description ?? ""),
        description: String(doc.description ?? ""),
        workArea: doc.workArea,
        rawPayload: doc.rawPayload,
        enrichmentText: Array.isArray(doc.capabilities)
          ? (doc.capabilities as string[]).join(" ")
          : undefined,
      })
    : [...new Set([...practiceAreas, ...relatedPracticeAreas])].slice(0, 16);
  const categories = Array.isArray(doc.categories) ? (doc.categories as string[]) : [];

  let legacyKind: SearchResult["legacyKind"] = "adl";
  if (entityType === "sra_organisation") legacyKind = "adl";

  const keywordScore = textMatch != null ? Math.min(1, textMatch / 1e8) : 0.5;

  const enrichmentStatus = String(doc.enrichmentStatus ?? "");
  let contactSource = String(doc.contactSource ?? "");
  const contactConfidence =
    typeof doc.contactConfidence === "number" ? doc.contactConfidence : undefined;

  const sraId = String(doc.sraId ?? doc.exactSraId ?? "");
  const searchText = String(doc.searchText ?? doc.description ?? "");
  const title = isSra
    ? String(doc.displayName ?? "").trim() ||
      resolveSraDisplayName(String(doc.title ?? ""), searchText, sraId, {
        displayName: String(doc.displayName ?? ""),
        tradingName: String(doc.tradingName ?? ""),
        organisationName: String(doc.organisationName ?? ""),
        firmName: String(doc.firmName ?? ""),
      })
    : String(doc.displayName ?? doc.title ?? "");
  const sraPhone =
    String(doc.phone ?? "").trim() ||
    (isSra ? extractPhoneFromSraSearchText(searchText) : null) ||
    undefined;
  if (isSra && sraPhone && !contactSource) contactSource = "sra_register";

  const result: import("@/lib/legal-search/types").SearchResult = {
    id,
    source,
    title,
    description: String(doc.description ?? ""),
    practiceAreas: mergedPracticeAreas,
    categories,
    location: {
      city: String(doc.city ?? "") || undefined,
      postcode: String(doc.postcode ?? "") || undefined,
      country: String(doc.country ?? "") || undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    },
    jurisdictions: Array.isArray(doc.jurisdictions) ? (doc.jurisdictions as string[]) : [],
    languages: Array.isArray(doc.languages) ? (doc.languages as string[]) : [],
    contact: {
      phone: sraPhone || String(doc.phone ?? "") || undefined,
      email: String(doc.email ?? "") || undefined,
      website: String(doc.website ?? "") || undefined,
    },
    url: String(doc.profileUrl ?? doc.website ?? "") || undefined,
    contactPageUrl:
      String(doc.contactPageUrl ?? doc.profileUrl ?? "").trim() || undefined,
    address: String(doc.address ?? "") || undefined,
    verified: doc.verified === true,
    rating: typeof doc.rating === "number" ? doc.rating : undefined,
    raw: {
      ...doc,
      capabilities: doc.capabilities,
      fundingCapabilities: doc.fundingCapabilities,
      urgencyCapabilities: doc.urgencyCapabilities,
      accessibilityCapabilities: doc.accessibilityCapabilities,
      tribunalCapabilities: doc.tribunalCapabilities,
      enrichmentStatus,
      contactSource,
      contactConfidence,
      _retrievalSources: ["typesense"],
      textMatch: textMatch ?? undefined,
    },
    scores: emptyScores({
      keyword: keywordScore,
      authority: typeof doc.authorityScore === "number" ? doc.authorityScore : 0.7,
      final: keywordScore,
    }),
    explanation: "",
    legacyKind,
    firmGroupId: undefined,
  };

  return enrichSearchResultForPublic(sanitiseContactForDisplay(result));
}

/** Hydrate listing-backed results with full legacy group data when possible. */
export function enrichListingResultsFromIndex(
  results: SearchResult[],
  parsed: ParsedQuery,
): SearchResult[] {
  const byId = new Map(fetchAllListings().map((l) => [l.id, l]));
  return results.map((r) => {
    if (r.source !== "curated_listing" && r.source !== "legal_aid") return r;
    const rawId = r.id.includes(":") ? r.id.split(":").pop()! : r.id;
    const listing = byId.get(rawId);
    if (!listing) return r;
    const hit: UnifiedSearchHit = {
      kind: "adl",
      hit: {
        listing,
        rrfScoreApprox: r.scores.final,
        sources: ["lexical"],
      },
    };
    return fromUnifiedHit(hit, parsed);
  });
}
