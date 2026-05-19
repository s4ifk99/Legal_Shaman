import type { SearchResult } from "@/lib/legal-search/types";
import type { UnifiedSearchHit } from "@/lib/search/unified-search";
import type { Listing } from "@/lib/data";
import { enableSearchDebug } from "@/lib/legal-search/config";

type LegacyAdl = {
  kind: "adl";
  id: string;
  businessName: string;
  description: string;
  city: string;
  postcode: string;
  phone: string;
  email: string;
  website?: string;
  category: string;
  subcategory: string;
  isFree: boolean;
  isLegalAid?: boolean;
  isSponsored: boolean;
  sources: ("lexical" | "semantic")[];
  explanation?: string;
  sourceType?: string;
  sraProfileUrl?: string;
  scores?: SearchResult["scores"];
};

type LegacyGroup = {
  kind: "adlGroup";
  firmGroupId: string;
  id: string;
  businessName: string;
  description: string;
  category: string;
  subcategory: string;
  isFree: boolean;
  isLegalAid: true;
  isSponsored: boolean;
  sources: ("lexical" | "semantic")[];
  locations: Array<Record<string, unknown>>;
  explanation?: string;
  sourceType?: string;
  scores?: SearchResult["scores"];
};

type LegacySra = {
  kind: "adl";
  id: string;
  businessName: string;
  description: string;
  city: string;
  postcode: string;
  phone: string;
  email: string;
  website?: string;
  category: string;
  subcategory: string;
  isFree: boolean;
  isLegalAid: boolean;
  isSponsored: boolean;
  sources: ("lexical" | "semantic")[];
  explanation?: string;
  sourceType: string;
  sraProfileUrl?: string;
  scores?: SearchResult["scores"];
};

export type LegacyGetRow = LegacyAdl | LegacyGroup | LegacySra;

/**
 * Map unified SearchResult[] to the existing GET /api/search JSON rows
 * so /search and clients keep working.
 */
export function toLegacyGetResponse(results: SearchResult[]): LegacyGetRow[] {
  const debug = enableSearchDebug();
  return results.map((r) => {
    if (r.legacyKind === "adlGroup" && r.raw && typeof r.raw === "object" && "kind" in r.raw) {
      const hit = r.raw as UnifiedSearchHit;
      if (hit.kind === "adlGroup") {
        const L = hit.representative.listing;
        const sources = [...new Set(hit.hits.flatMap((x) => x.sources))] as (
          | "lexical"
          | "semantic"
        )[];
        return {
          kind: "adlGroup" as const,
          firmGroupId: hit.firmGroupId,
          id: hit.firmGroupId,
          businessName: L.businessName,
          description: L.description,
          category: L.category,
          subcategory: L.subcategory,
          isFree: L.isFree,
          isLegalAid: true as const,
          isSponsored: L.isSponsored,
          sources,
          locations: hit.hits.map((h) => {
            const l = h.listing;
            return {
              id: l.id,
              city: l.city,
              postcode: l.postcode,
              phone: l.phone,
              email: l.email,
              address: l.address,
              website: l.website,
              subcategory: l.subcategory,
              description: l.description,
            };
          }),
          ...(debug ? { explanation: r.explanation, sourceType: r.source, scores: r.scores } : {}),
        };
      }
    }

    if (r.source === "sra") {
      const doc = r.raw as import("@/lib/search/sra-document").SraMeiliDocument;
      return {
        kind: "adl" as const,
        id: r.id,
        businessName: r.title,
        description: r.description ?? doc.searchText,
        city: doc.city,
        postcode: doc.postcode,
        phone: "",
        email: "",
        website: doc.sraProfileUrl,
        category: "SRA",
        subcategory: "sra-organisation",
        isFree: false,
        isLegalAid: false,
        isSponsored: false,
        sources: ["lexical"] as ("lexical" | "semantic")[],
        ...(debug ? { explanation: r.explanation, scores: r.scores } : {}),
        sourceType: "sra",
        sraProfileUrl: doc.sraProfileUrl,
      };
    }

    const raw = r.raw as {
      listing?: Listing;
      sources?: ("lexical" | "semantic")[];
    };
    const listing = raw.listing;
    if (!listing) {
      return {
        kind: "adl" as const,
        id: r.id,
        businessName: r.title,
        description: r.description ?? "",
        city: r.location?.city ?? "",
        postcode: r.location?.postcode ?? "",
        phone: r.contact?.phone ?? "",
        email: r.contact?.email ?? "",
        website: r.contact?.website,
        category: r.categories[0] ?? "",
        subcategory: r.categories[1] ?? "",
        isFree: false,
        isLegalAid: r.source === "legal_aid",
        isSponsored: false,
        sources: (raw.sources ?? ["lexical"]) as ("lexical" | "semantic")[],
        ...(debug ? { explanation: r.explanation, sourceType: r.source, scores: r.scores } : {}),
      };
    }

    return {
      kind: "adl" as const,
      id: listing.id,
      businessName: listing.businessName,
      description: listing.description,
      city: listing.city,
      postcode: listing.postcode,
      phone: listing.phone,
      email: listing.email,
      website: listing.website,
      category: listing.category,
      subcategory: listing.subcategory,
      isFree: listing.isFree,
      isLegalAid: listing.isLegalAid,
      isSponsored: listing.isSponsored,
      sources: (raw.sources ?? ["lexical"]) as ("lexical" | "semantic")[],
      ...(debug ? { explanation: r.explanation, sourceType: r.source, scores: r.scores } : {}),
    };
  });
}
