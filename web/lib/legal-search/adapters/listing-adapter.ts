import "server-only";

import type { UnifiedSearchHit } from "@/lib/search/unified-search";
import type { SraMeiliDocument } from "@/lib/search/sra-document";
import { enrichSearchResultForPublic } from "@/lib/legal-search/public-search-result";
import {
  extractPhoneFromSraSearchText,
  resolveSraDisplayName,
} from "@/lib/search/sra-display";
import { sanitiseContactForDisplay } from "@/lib/provider-intelligence/provider-capability-ranker";
import type { Listing } from "@/lib/data";
import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { emptyScores } from "@/lib/legal-search/ranking";
import { resolveSraPracticeAreasForDisplay } from "@/lib/search/sra-practice-areas";

function mapListingSources(sources: ("lexical" | "semantic")[]): RetrievalSource[] {
  const out: RetrievalSource[] = [];
  if (sources.includes("lexical")) out.push("legacy");
  if (sources.includes("semantic")) out.push("pgvector");
  return out.length ? out : ["legacy"];
}

function listingToResult(
  listing: Listing,
  sources: ("lexical" | "semantic")[],
  legacyKind: "adl" | "adlGroup",
  firmGroupId?: string,
): SearchResult {
  const source: SearchResult["source"] = listing.isLegalAid ? "legal_aid" : "curated_listing";
  const practiceAreas: string[] = [];
  if (listing.legalAidGovCategory) practiceAreas.push(listing.legalAidGovCategory);
  if (listing.subcategory) practiceAreas.push(listing.subcategory.replace(/-/g, " "));

  return {
    id: listing.id,
    source,
    title: listing.businessName,
    description: listing.description,
    practiceAreas,
    categories: [listing.category, listing.subcategory].filter(Boolean),
    location: {
      city: listing.city,
      postcode: listing.postcode,
    },
    contact: {
      phone: listing.phone,
      email: listing.email,
      website: listing.website,
    },
    url: listing.website,
    verified: false,
    raw: { listing, sources, legacyKind, firmGroupId, _retrievalSources: mapListingSources(sources) },
    scores: emptyScores({
      keyword: sources.includes("lexical") ? 0.7 : 0.3,
      semantic: sources.includes("semantic") ? 0.7 : 0,
    }),
    explanation: "",
    legacyKind,
    firmGroupId,
  };
}

export function fromUnifiedHit(hit: UnifiedSearchHit, parsed: ParsedQuery): SearchResult {
  if (hit.kind === "adl") {
    return listingToResult(hit.hit.listing, hit.hit.sources, "adl");
  }
  const rep = hit.representative.listing;
  const sources = [...new Set(hit.hits.flatMap((h) => h.sources))];
  const base = listingToResult(rep, sources, "adlGroup", hit.firmGroupId);
  /** Preserve full grouped hit for legacy GET mapping (locations array). */
  return {
    ...base,
    raw: { ...hit, _retrievalSources: mapListingSources(sources) },
  };
}

export function fromSraMeili(
  doc: SraMeiliDocument,
  parsed: ParsedQuery,
  retrievalSource: RetrievalSource = "meilisearch",
): SearchResult {
  const displayName = resolveSraDisplayName(doc.businessName, doc.searchText, doc.sraId);
  const pa = resolveSraPracticeAreasForDisplay({
    organisationName: displayName,
    searchText: doc.searchText,
    workArea: doc.workArea,
    rawPayload: doc.rawPayload,
  });
  const phone = doc.phone?.trim() || extractPhoneFromSraSearchText(doc.searchText) || undefined;
  const email = doc.email?.trim() || undefined;
  const website =
    doc.website?.trim() && !doc.website.includes("sra.org.uk") ? doc.website.trim() : undefined;
  return enrichSearchResultForPublic(
    sanitiseContactForDisplay({
      id: `sra:${doc.sraId}`,
      source: "sra",
      title: displayName,
      description: doc.searchText.slice(0, 400),
      practiceAreas: pa,
      categories: ["SRA organisation"],
      location: {
        city: doc.city,
        postcode: doc.postcode,
        country: doc.country,
      },
      jurisdictions: [],
      contact: { phone, email, website },
      url: website,
      contactPageUrl: doc.sraProfileUrl,
      verified: true,
      raw: {
        ...doc,
        entityType: "sra_organisation",
        contactSource: phone || doc.sraProfileUrl ? "sra_register" : undefined,
        _retrievalSources: [retrievalSource] as RetrievalSource[],
      },
      scores: emptyScores({ keyword: 0.55, semantic: 0.4 }),
      explanation: "",
      legacyKind: "sra",
      sraOrganisationId: doc.sraId,
    }),
  );
}
