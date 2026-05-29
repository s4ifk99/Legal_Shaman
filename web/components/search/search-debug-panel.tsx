"use client";

import type { SearchResponseDebug } from "@/lib/legal-search/search-diagnostics-types";

type SearchDebugPanelProps = {
  searchDebug: SearchResponseDebug;
};

export function SearchDebugPanel({ searchDebug }: SearchDebugPanelProps) {
  return (
    <details className="rounded-lg border border-amber-500/50 bg-amber-50/60 p-4 dark:border-amber-800/50 dark:bg-amber-950/30">
      <summary className="cursor-pointer text-sm font-semibold text-amber-950 dark:text-amber-100">
        Debug search
      </summary>
      <div className="mt-3 space-y-3 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Query prefix: </span>
          {searchDebug.queryPrefix}
        </p>
        <p>
          <span className="font-medium text-foreground">Channel: </span>
          {searchDebug.channel}
          <span className="mx-2">·</span>
          <span className="font-medium text-foreground">Reranker: </span>
          {searchDebug.rerankerVersion}
          {searchDebug.openRerankerModel
            ? ` · open: ${searchDebug.openRerankerModel}${searchDebug.openRerankerDegraded ? " (degraded)" : ""}`
            : ""}
          <span className="mx-2">·</span>
          <span className="font-medium text-foreground">Latency: </span>
          {searchDebug.latencyMs} ms
        </p>
        {searchDebug.expandedSearchText ? (
          <p>
            <span className="font-medium text-foreground">Expanded search: </span>
            <span className="line-clamp-3">{searchDebug.expandedSearchText}</span>
          </p>
        ) : null}
        {searchDebug.taxonomyMatch ? (
          <p>
            <span className="font-medium text-foreground">Taxonomy: </span>
            {[searchDebug.taxonomyMatch.label, searchDebug.taxonomyMatch.slug]
              .filter(Boolean)
              .join(" · ")}
            {searchDebug.taxonomyMatch.confidence
              ? ` (${searchDebug.taxonomyMatch.confidence})`
              : ""}
          </p>
        ) : null}
        {searchDebug.queryConfidence ? (
          <p>
            <span className="font-medium text-foreground">Query confidence: </span>
            {searchDebug.queryConfidence}
          </p>
        ) : null}
        {searchDebug.clarificationDecision ? (
          <p>
            <span className="font-medium text-foreground">Clarification: </span>
            {searchDebug.clarificationDecision}
          </p>
        ) : null}
        {searchDebug.searchedFields && searchDebug.searchedFields.length > 0 ? (
          <p>
            <span className="font-medium text-foreground">Searched fields: </span>
            {searchDebug.searchedFields.join(", ")}
          </p>
        ) : null}
        {searchDebug.activeSearchEngine ? (
          <p>
            <span className="font-medium text-foreground">Search engine: </span>
            {searchDebug.activeSearchEngine}
          </p>
        ) : null}
        {searchDebug.fallbackTriggered != null ? (
          <p>
            <span className="font-medium text-foreground">Fallback triggered: </span>
            {searchDebug.fallbackTriggered ? "yes" : "no"}
            {searchDebug.initialTypesenseHitCount != null
              ? ` · initial: ${searchDebug.initialTypesenseHitCount}`
              : ""}
            {searchDebug.finalHitCount != null
              ? ` · final: ${searchDebug.finalHitCount}`
              : ""}
          </p>
        ) : null}
        {searchDebug.retrievalSources && searchDebug.retrievalSources.length > 0 ? (
          <p>
            <span className="font-medium text-foreground">Retrieval sources: </span>
            {searchDebug.retrievalSources.join(", ")}
          </p>
        ) : null}
        {searchDebug.taxonomyProjectionMatches &&
        searchDebug.taxonomyProjectionMatches.length > 0 ? (
          <p>
            <span className="font-medium text-foreground">Taxonomy projections: </span>
            {searchDebug.taxonomyProjectionMatches.join(", ")}
          </p>
        ) : null}
        {searchDebug.typesenseQueries ? (
          <details className="mt-1">
            <summary className="cursor-pointer font-medium text-foreground">
              Typesense queries
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-background/80 p-2 font-mono text-[10px]">
              {JSON.stringify(searchDebug.typesenseQueries, null, 2)}
            </pre>
          </details>
        ) : null}
        {Object.keys(searchDebug.resultCountsBySource).length > 0 ? (
          <div>
            <p className="font-medium text-foreground">Results by retrieval source</p>
            <ul className="mt-1 list-inside list-disc">
              {Object.entries(searchDebug.resultCountsBySource).map(([src, n]) => (
                <li key={src}>
                  {src}: {n}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {searchDebug.degradedModeWarnings.length > 0 ? (
          <p className="text-amber-800 dark:text-amber-300">
            <span className="font-medium">Degraded: </span>
            {searchDebug.degradedModeWarnings.join(", ")}
          </p>
        ) : null}
        {searchDebug.fundingIntent ? (
          <div className="space-y-1 rounded border border-emerald-300/60 bg-emerald-50/50 p-2 dark:border-emerald-800 dark:bg-emerald-950/30">
            <p className="font-medium text-foreground">Funding and source diversity</p>
            <p>Funding intent: {searchDebug.fundingIntent}</p>
            <p>
              Diversity applied: {searchDebug.sourceDiversityApplied ? "yes" : "no"}
              {searchDebug.sourceCaps
                ? ` · cap ${searchDebug.sourceCaps.maxLegalAidInTopK}/${searchDebug.sourceCaps.topK} legal aid`
                : ""}
            </p>
            <p>Legal aid boost: {searchDebug.legalAidBoostApplied ? "yes" : "no"}</p>
            {searchDebug.legalAidBoostReason ? (
              <p className="text-[11px]">{searchDebug.legalAidBoostReason}</p>
            ) : null}
            {searchDebug.preDiversificationSourceCounts ? (
              <p>
                Pre-diversity:{" "}
                {Object.entries(searchDebug.preDiversificationSourceCounts)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")}
              </p>
            ) : null}
            {searchDebug.postDiversificationSourceCounts ? (
              <p>
                Post-diversity:{" "}
                {Object.entries(searchDebug.postDiversificationSourceCounts)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
        {searchDebug.triageCompletenessScore != null ? (
          <div className="space-y-1 rounded border border-violet-300/60 bg-violet-50/50 p-2 dark:border-violet-800 dark:bg-violet-950/30">
            <p className="font-medium text-foreground">Triage completeness</p>
            <p>Score: {searchDebug.triageCompletenessScore}</p>
            <p>Missing: {(searchDebug.triageMissingFields ?? []).join(", ") || "—"}</p>
            <p>Next question: {searchDebug.triageNextBestQuestion ?? "—"}</p>
            <p>Funding route: {searchDebug.fundingRouteDecision ?? "—"}</p>
            <p>Urgency: {searchDebug.urgencyDecision ?? "—"}</p>
            <p>External fallback: {searchDebug.externalFallbackDecision ?? "—"}</p>
          </div>
        ) : null}
        {searchDebug.externalFallbackTriggered ? (
          <div className="space-y-1 rounded border border-sky-300/60 bg-sky-50/50 p-2 dark:border-sky-800 dark:bg-sky-950/30">
            <p className="font-medium text-foreground">External fallback</p>
            <p>Reason: {searchDebug.externalFallbackReason ?? "—"}</p>
            <p>Sources: {(searchDebug.externalFallbackSourcesQueried ?? []).join(", ") || "—"}</p>
            <p>External results: {searchDebug.externalResultsCount ?? 0}</p>
            {(searchDebug.externalFallbackVerificationWarnings ?? []).length > 0 ? (
              <p>Warnings: {searchDebug.externalFallbackVerificationWarnings!.join(", ")}</p>
            ) : null}
          </div>
        ) : null}
        {searchDebug.filtersApplied &&
        Object.keys(searchDebug.filtersApplied).length > 0 ? (
          <div>
            <p className="font-medium text-foreground">Filters applied</p>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-background/80 p-2 font-mono text-[10px]">
              {JSON.stringify(searchDebug.filtersApplied, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}
