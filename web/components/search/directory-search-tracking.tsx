"use client";

import { SearchImpressionBeacon } from "@/components/search-analytics";
import { SearchResultImpressions } from "@/components/search/search-result-impressions";
import type { SearchResultSource } from "@/lib/search-events/types";

export type DirectoryImpressionRow = {
  resultId: string;
  resultSource: SearchResultSource;
};

type DirectorySearchTrackingProps = {
  searchKey: string;
  q: string;
  resultCount: number;
  rows: DirectoryImpressionRow[];
  parsedPracticeArea?: string;
  parsedLocation?: string;
  freeOnly?: boolean;
  legalAidOnly?: boolean;
  city?: string;
};

export function DirectorySearchTracking({
  searchKey,
  q,
  resultCount,
  rows,
  parsedPracticeArea,
  parsedLocation,
  freeOnly,
  legalAidOnly,
  city,
}: DirectorySearchTrackingProps) {
  return (
    <>
      <SearchImpressionBeacon
        q={q}
        resultCount={resultCount}
        semantic={false}
        freeOnly={freeOnly}
        legalAidOnly={legalAidOnly}
        city={city}
        parsedPracticeArea={parsedPracticeArea}
        page="directory"
      />
      <SearchResultImpressions
        searchKey={searchKey}
        page="directory"
        query={q}
        parsedPracticeArea={parsedPracticeArea}
        parsedLocation={parsedLocation ?? city}
        targets={rows.map((r, i) => ({
          resultId: r.resultId,
          resultSource: r.resultSource,
          resultRank: i + 1,
        }))}
      />
    </>
  );
}
