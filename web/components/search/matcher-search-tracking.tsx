"use client";

import { useEffect } from "react";
import { SearchResultImpressions } from "@/components/search/search-result-impressions";
import { trackSearchEvent } from "@/lib/search-events/client";
import type { AnyMatch } from "@/lib/agent/types";
import type { SearchResultSource } from "@/lib/search-events/types";

function matchSource(m: AnyMatch): SearchResultSource {
  return m.kind === "lawyer" ? "lawyer" : "sra";
}

type MatcherSearchTrackingProps = {
  searchKey: string;
  query: string;
  results: AnyMatch[];
  parsedPracticeArea?: string;
  parsedLocation?: string;
};

export function MatcherSearchTracking({
  searchKey,
  query,
  results,
  parsedPracticeArea,
  parsedLocation,
}: MatcherSearchTrackingProps) {
  useEffect(() => {
    if (query.trim().length < 2) return;
    if (results.length === 0) {
      trackSearchEvent({
        eventType: "no_result_search",
        page: "find_a_lawyer",
        query,
        parsedPracticeArea,
        parsedLocation,
      });
    }
  }, [searchKey, query, results.length, parsedPracticeArea, parsedLocation]);

  return (
    <SearchResultImpressions
      searchKey={searchKey}
      page="find_a_lawyer"
      query={query}
      parsedPracticeArea={parsedPracticeArea}
      parsedLocation={parsedLocation}
      targets={results.map((r, i) => ({
        resultId: r.id,
        resultSource: matchSource(r),
        resultRank: i + 1,
      }))}
    />
  );
}
