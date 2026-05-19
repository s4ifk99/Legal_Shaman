"use client";

import { useEffect, useRef } from "react";
import { trackSearchEvent } from "@/lib/search-events/client";
import type { SearchEventPage, SearchResultSource } from "@/lib/search-events/types";

type ImpressionTarget = {
  resultId: string;
  resultSource: SearchResultSource;
  resultRank: number;
};

type SearchResultImpressionsProps = {
  searchKey: string;
  page: SearchEventPage;
  query?: string;
  parsedPracticeArea?: string;
  parsedLocation?: string;
  searchInteractionId?: string;
  targets: ImpressionTarget[];
};

export function SearchResultImpressions({
  searchKey,
  page,
  query,
  parsedPracticeArea,
  parsedLocation,
  searchInteractionId,
  targets,
}: SearchResultImpressionsProps) {
  const sentRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    sentRef.current = new Set();
  }, [searchKey]);

  useEffect(() => {
    if (!targets.length) return;
    for (const t of targets) {
      const dedupeKey = `${searchKey}:${t.resultId}:${t.resultSource}`;
      if (sentRef.current.has(dedupeKey)) continue;
      sentRef.current.add(dedupeKey);
      trackSearchEvent({
        eventType: "result_impression",
        page,
        query,
        parsedPracticeArea,
        parsedLocation,
        searchInteractionId,
        resultId: t.resultId,
        resultSource: t.resultSource,
        resultRank: t.resultRank,
      });
    }
  }, [
    searchKey,
    page,
    query,
    parsedPracticeArea,
    parsedLocation,
    searchInteractionId,
    targets,
  ]);

  return null;
}
