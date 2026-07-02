"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TriageResultSection } from "@/lib/legal-search/triage/types";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { legacyRowFromSearchResult } from "@/lib/legal-search/legacy-get-response";
import { DirectoryResultDetail } from "@/components/search/directory-result-detail";
import { TriageResultContactLinks } from "@/components/triage/triage-result-contact-links";
import {
  publicResultTitle,
} from "@/lib/legal-search/public-search-result";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TriageResultsSectionsProps = {
  sections: TriageResultSection[];
  legacyRowByResultId?: Record<string, LegacyGetRow>;
  query: string;
  parsedPracticeArea?: string;
  parsedLocation?: string;
};

export function TriageResultsSections({
  sections,
  legacyRowByResultId = {},
  query,
  parsedPracticeArea,
  parsedLocation,
}: TriageResultsSectionsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = useCallback((resultId: string) => {
    setExpandedId((current) => (current === resultId ? null : resultId));
  }, []);

  useEffect(() => {
    if (!expandedId) return;
    document
      .querySelector(`[data-entity-id="${CSS.escape(expandedId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [expandedId]);

  if (!sections.length) {
    return (
      <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
        No providers matched yet. Try widening your search or adjusting funding preference.
      </p>
    );
  }

  const resultIndex = new Map<string, number>();
  let index = 0;
  for (const section of sections) {
    for (const r of section.results) {
      resultIndex.set(r.id, index++);
    }
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Click a result for full contact details and office information.
      </p>
      {sections.map((section) => (
        <section key={section.kind} className="space-y-3">
          <h2 className="font-serif text-lg font-semibold text-primary">{section.title}</h2>
          <ul className="space-y-3">
            {section.results.map((r) => (
              <TriageResultItem
                key={r.id}
                result={r}
                legacyRow={legacyRowByResultId[r.id]}
                isExpanded={expandedId === r.id}
                onToggle={() => toggleExpand(r.id)}
                query={query}
                index={resultIndex.get(r.id) ?? 0}
                parsedPracticeArea={parsedPracticeArea}
                parsedLocation={parsedLocation}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TriageResultItem({
  result,
  legacyRow,
  isExpanded,
  onToggle,
  query,
  index,
  parsedPracticeArea,
  parsedLocation,
}: {
  result: import("@/lib/legal-search/types").SearchResult;
  legacyRow?: LegacyGetRow;
  isExpanded: boolean;
  onToggle: () => void;
  query: string;
  index: number;
  parsedPracticeArea?: string;
  parsedLocation?: string;
}) {
  const isSra = result.source === "sra";
  const title = result.displayName?.trim() || publicResultTitle(result);
  const detailRow = legacyRow ?? legacyRowFromSearchResult(result);
  const sourceLabel = result.sourceLabel ?? "Directory listing";
  const locationLabel = result.locationLabel;
  const practiceLine =
    result.practiceAreas.length > 0
      ? `Practice areas: ${result.practiceAreas.slice(0, 4).join(", ")}`
      : null;

  return (
    <li data-entity-id={result.id}>
      <Card
        className={cn(
          "overflow-hidden transition-shadow",
          isSra ? "border-emerald-500/20" : "border-primary/15",
          isExpanded && "shadow-md ring-2 ring-primary/40",
        )}
      >
        <button
          type="button"
          className="w-full cursor-pointer text-left"
          onClick={onToggle}
          aria-expanded={isExpanded}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {sourceLabel}
                  </span>
                </div>
                {practiceLine ? (
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{practiceLine}</p>
                ) : null}
                {locationLabel ? (
                  <p className="mt-1 text-sm text-muted-foreground">Location: {locationLabel}</p>
                ) : null}
                {!isExpanded && result.explanation ? (
                  <p className="mt-2 text-sm leading-relaxed text-foreground/90 line-clamp-2">
                    <span className="font-medium">Why shown: </span>
                    {result.explanation}
                  </p>
                ) : null}
              </div>
              <ChevronDown
                className={cn(
                  "mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
            </div>
          </CardContent>
        </button>

        {isExpanded ? (
          <>
            <div className="border-t border-border/40 px-4 pb-4">
              <TriageResultContactLinks result={result} />
            </div>
            <DirectoryResultDetail
              row={detailRow}
              explanation={result.explanation}
              q={query}
              index={index}
              parsedPracticeArea={parsedPracticeArea}
              parsedLocation={parsedLocation}
            />
          </>
        ) : null}
      </Card>
    </li>
  );
}

