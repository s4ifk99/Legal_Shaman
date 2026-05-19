"use client";

import type { ResultDebugDiagnostics } from "@/lib/legal-search/search-diagnostics-types";

type ResultDebugSectionProps = {
  debug: ResultDebugDiagnostics;
};

export function ResultDebugSection({ debug }: ResultDebugSectionProps) {
  return (
    <details className="mt-3 rounded-md border border-dashed border-amber-500/40 bg-amber-50/50 p-3 text-xs dark:bg-amber-950/20">
      <summary className="cursor-pointer font-medium text-amber-900 dark:text-amber-200">
        Why this result? (debug)
      </summary>
      <div className="mt-2 space-y-2 text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Sources: </span>
          {debug.retrievalSources.join(", ") || "—"}
        </p>
        {debug.originalRankBySource && Object.keys(debug.originalRankBySource).length > 0 ? (
          <p>
            <span className="font-medium text-foreground">Rank by source: </span>
            {Object.entries(debug.originalRankBySource)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
          </p>
        ) : null}
        <p>
          <span className="font-medium text-foreground">Final score: </span>
          {debug.finalScore.toFixed(3)}
          {debug.distanceMiles != null ? ` · ${debug.distanceMiles} mi` : ""}
        </p>
        {debug.vectorDistance != null ? (
          <p>
            <span className="font-medium text-foreground">Vector distance: </span>
            {debug.vectorDistance.toFixed(4)}
          </p>
        ) : null}
        {debug.typesenseScore != null ? (
          <p>
            <span className="font-medium text-foreground">Typesense score: </span>
            {debug.typesenseScore}
          </p>
        ) : null}
        <div>
          <p className="font-medium text-foreground">Score breakdown</p>
          <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
            {Object.entries(debug.scoreBreakdown).map(([k, v]) => (
              <li key={k} className="contents">
                <span>{k}</span>
                <span>{typeof v === "number" ? v.toFixed(3) : String(v)}</span>
              </li>
            ))}
          </ul>
        </div>
        {debug.matchedPracticeAreas.length > 0 ? (
          <p>
            <span className="font-medium text-foreground">Practice areas: </span>
            {debug.matchedPracticeAreas.join(", ")}
          </p>
        ) : null}
        {debug.matchedTaxonomyTerms.length > 0 ? (
          <p>
            <span className="font-medium text-foreground">Taxonomy: </span>
            {debug.matchedTaxonomyTerms.join(", ")}
          </p>
        ) : null}
        {debug.matchedLocationSignals.length > 0 ? (
          <p>
            <span className="font-medium text-foreground">Location signals: </span>
            {debug.matchedLocationSignals.join("; ")}
          </p>
        ) : null}
        {debug.explanationInputs.length > 0 ? (
          <p>
            <span className="font-medium text-foreground">Explanation inputs: </span>
            {debug.explanationInputs[0]}
          </p>
        ) : null}
        {debug.warnings.length > 0 ? (
          <p className="text-amber-800 dark:text-amber-300">
            Warnings: {debug.warnings.join("; ")}
          </p>
        ) : null}
      </div>
    </details>
  );
}
