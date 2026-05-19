"use client";

import { useEffect } from "react";
import { trackSearchEvent } from "@/lib/search-events/client";
import type { SearchEventPage, SearchResultSource } from "@/lib/search-events/types";

type SearchImpressionProps = {
  q: string;
  resultCount: number;
  semantic: boolean;
  freeOnly?: boolean;
  legalAidOnly?: boolean;
  city?: string;
  parsedPracticeArea?: string;
  page?: SearchEventPage;
};

export function SearchImpressionBeacon({
  q,
  resultCount,
  semantic,
  freeOnly,
  legalAidOnly,
  city,
  parsedPracticeArea,
  page = "directory",
}: SearchImpressionProps) {
  useEffect(() => {
    if (q.trim().length < 2) return;
    if (resultCount === 0) {
      trackSearchEvent({
        eventType: "no_result_search",
        page,
        query: q,
        parsedPracticeArea,
        parsedLocation: city,
        metadata: { semantic, freeOnly, legalAidOnly },
      });
    }
  }, [q, resultCount, semantic, freeOnly, legalAidOnly, city, parsedPracticeArea, page]);

  return null;
}

type ResultClickProps = {
  listingId: string;
  position: number;
  q: string;
  resultSource?: SearchResultSource;
  page?: SearchEventPage;
  parsedPracticeArea?: string;
  parsedLocation?: string;
  eventType?: "result_click" | "contact_cta_click" | "phone_click" | "website_click";
};

export function logSearchResultClick({
  listingId,
  position,
  q,
  resultSource = "curated_listing",
  page = "directory",
  parsedPracticeArea,
  parsedLocation,
  eventType = "result_click",
}: ResultClickProps) {
  trackSearchEvent({
    eventType,
    page,
    query: q,
    parsedPracticeArea,
    parsedLocation,
    resultId: listingId,
    resultSource,
    resultRank: position + 1,
  });
}

export function logRefinementClick(args: {
  q: string;
  page?: SearchEventPage;
  parsedPracticeArea?: string;
  parsedLocation?: string;
}) {
  trackSearchEvent({
    eventType: "refinement_click",
    page: args.page ?? "directory",
    query: args.q,
    parsedPracticeArea: args.parsedPracticeArea,
    parsedLocation: args.parsedLocation,
  });
}

export function logMapMarkerClick(args: {
  entityId: string;
  resultSource: SearchResultSource;
  q?: string;
  page?: SearchEventPage;
  resultRank?: number;
}) {
  trackSearchEvent({
    eventType: "map_marker_click",
    page: args.page ?? "directory",
    query: args.q,
    resultId: args.entityId,
    resultSource: args.resultSource,
    resultRank: args.resultRank,
  });
}
