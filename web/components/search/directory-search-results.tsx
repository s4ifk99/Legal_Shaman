"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SearchResultsLayout } from "@/components/search/search-results-layout";
import { DirectoryResultDetail } from "@/components/search/directory-result-detail";
import { BookmarkButton } from "@/components/bookmarks/bookmark-button";
import { bookmarkMetaFromLegacyRow } from "@/lib/bookmarks/types";
import { ResultDebugSection } from "@/components/search/result-debug-section";
import { ExternalFallbackSection } from "@/components/triage/external-fallback-section";
import { SraAttribution } from "@/components/sra-attribution";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import type { MapMarker } from "@/lib/search/map-results";
import {
  collapsedDirectorySummary,
  stableDirectoryRowKey,
} from "@/lib/search/directory-row-display";
import { entityIdFromLegacyRow, searchUrlForListingName } from "@/lib/search/result-navigation";
import type { Listing } from "@/lib/data";
import type { ExternalFallbackPayload } from "@/lib/legal-search/external-fallback/types";
import type { ResultDebugDiagnostics } from "@/lib/legal-search/search-diagnostics-types";
import { cn } from "@/lib/utils";

function matchExplainAdl(sources: ("lexical" | "semantic")[]): string {
  const lex = sources.includes("lexical");
  const sem = sources.includes("semantic");
  if (lex && sem) return "Keywords + similar topic";
  if (sem) return "Similar topic";
  return "Matched keywords";
}

function stableRowKey(row: LegacyGetRow): string {
  return stableDirectoryRowKey(row);
}

function collapsedSummary(row: LegacyGetRow): string {
  return collapsedDirectorySummary(row);
}

type DirectorySearchResultsProps = {
  rows: LegacyGetRow[];
  explanations: string[];
  debugByIndex: (ResultDebugDiagnostics | undefined)[];
  q: string;
  parsedPracticeArea?: string;
  parsedLocation?: string;
  freeOnly: boolean;
  legalAidOnly: boolean;
  cityFacet: string;
  markers: MapMarker[];
  missingCoordinatesCount: number;
  externalFallback?: ExternalFallbackPayload | null;
  citizensFallback: Listing[];
  initialExpandedId?: string;
};

export function DirectorySearchResults({
  rows,
  explanations,
  debugByIndex,
  q,
  parsedPracticeArea,
  parsedLocation,
  freeOnly,
  legalAidOnly,
  cityFacet,
  markers,
  missingCoordinatesCount,
  externalFallback,
  citizensFallback,
  initialExpandedId,
}: DirectorySearchResultsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);

  useEffect(() => {
    if (initialExpandedId) setExpandedId(initialExpandedId);
  }, [initialExpandedId]);

  const toggleExpand = useCallback((entityId: string) => {
    setExpandedId((current) => (current === entityId ? null : entityId));
  }, []);

  useEffect(() => {
    if (!expandedId) return;
    const el = document.querySelector(`[data-entity-id="${CSS.escape(expandedId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [expandedId]);

  return (
    <SearchResultsLayout markers={markers} missingCoordinatesCount={missingCoordinatesCount}>
      <p className="mb-4 text-sm text-muted-foreground">
        {rows.length} result{rows.length === 1 ? "" : "s"}
        {(freeOnly || legalAidOnly || cityFacet) && " · filters applied"}
        {rows.length > 0 ? " · click a result for full details · bookmark firms to save them" : null}
      </p>
      <ul className="space-y-3">
        {rows.map((row, index) => {
          const explanation = explanations[index];
          const resultDebug = debugByIndex[index];
          const entityId = entityIdFromLegacyRow(row);
          const isExpanded = expandedId === entityId;
          const isSra = row.kind === "adl" && row.sourceType === "sra";
          const bookmark = bookmarkMetaFromLegacyRow(row);

          return (
            <li key={stableRowKey(row)} data-entity-id={entityId}>
              <Card
                className={cn(
                  "overflow-hidden transition-shadow",
                  isSra ? "border-emerald-500/20" : "border-primary/15",
                  isExpanded && "shadow-md ring-2 ring-primary/40",
                )}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => toggleExpand(entityId)}
                  aria-expanded={isExpanded}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground md:text-lg">
                            {row.businessName}
                          </h3>
                          {isSra ? (
                            <Badge variant="outline" className="border-emerald-600/40 text-emerald-800">
                              SRA
                            </Badge>
                          ) : null}
                          {row.kind === "adl" && !isSra && row.isFree ? (
                            <Badge className="bg-green-100 text-green-800">Free</Badge>
                          ) : null}
                          {row.kind === "adl" && !isSra && row.isLegalAid ? (
                            <Badge variant="secondary">Legal Aid *</Badge>
                          ) : null}
                          {row.kind === "adlGroup" ? (
                            <Badge variant="secondary">Legal Aid *</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                          {collapsedSummary(row)}
                        </p>
                        {!isExpanded && row.kind === "adl" && !isSra ? (
                          <p className="mt-1 text-[11px] text-muted-foreground/80">
                            {matchExplainAdl(row.sources)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        <BookmarkButton bookmark={bookmark} showLabel={false} />
                        <ChevronDown
                          className={cn(
                            "mt-1 h-5 w-5 text-muted-foreground transition-transform",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </div>
                    </div>
                  </CardContent>
                </button>

                {isExpanded ? (
                  <>
                    <DirectoryResultDetail
                      row={row}
                      explanation={explanation}
                      q={q}
                      index={index}
                      parsedPracticeArea={parsedPracticeArea}
                      parsedLocation={parsedLocation}
                    />
                    {resultDebug ? (
                      <div className="border-t border-border/60 px-5 pb-5 md:px-6">
                        <ResultDebugSection debug={resultDebug} />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
      {rows.length > 0 ? <SraAttribution className="mt-6 text-xs leading-relaxed text-muted-foreground" /> : null}
      {externalFallback?.triggered ? (
        <div className="mt-8">
          <ExternalFallbackSection payload={externalFallback} />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No listings matched your search and filters. Try different words, clear filters, or browse{" "}
              <Link href="/" className="text-primary underline">
                categories
              </Link>
              .
            </CardContent>
          </Card>
          {citizensFallback.length > 0 ? (
            <Card className="border-green-200/50 bg-green-50/40 dark:bg-green-950/20">
              <CardContent className="p-4">
                <p className="mb-2 text-sm font-medium text-foreground">Not sure where to start?</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Citizens Advice offers general guidance and signposting (not a substitute for a solicitor).
                </p>
                <ul className="space-y-2 text-sm">
                  {citizensFallback.map((l) => (
                    <li key={l.id}>
                      <Link href={searchUrlForListingName(l.businessName)} className="text-primary underline">
                        {l.businessName}
                      </Link>
                      {l.phone ? <span className="text-muted-foreground"> · {l.phone}</span> : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </SearchResultsLayout>
  );
}
