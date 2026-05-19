export type FailedSearchRow = {
  id: string;
  rawQuery: string;
  channel: string | null;
  resultCount: number | null;
  createdAt: string;
  parsedTaxonomy?: string | null;
  queryConfidence?: string | null;
  clarifyingAsked: boolean;
  mapUsed: boolean | null;
  degradedModes: unknown;
  failureKind:
    | "zero_results"
    | "low_results"
    | "low_clicks"
    | "external_fallback_signal"
    | "low_confidence";
  clusterLabel: string;
  clusterHint: string | null;
  impressionCount: number;
  clickCount: number;
  refinementCount: number;
  noResultEventCount: number;
};
