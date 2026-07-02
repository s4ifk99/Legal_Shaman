"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { DirectoryResultDetail } from "@/components/search/directory-result-detail";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import {
  collapsedDirectorySummary,
  stableDirectoryRowKey,
} from "@/lib/search/directory-row-display";
import { entityIdFromLegacyRow } from "@/lib/search/result-navigation";
import type { SearchResultSource } from "@/lib/search-events/types";
import { cn } from "@/lib/utils";

export type DirectoryListItem = {
  row?: LegacyGetRow;
  entityId?: string;
  resultSource?: SearchResultSource;
  businessName: string;
  explanation?: string;
  subtitle?: string;
};

type ExpandableDirectoryListProps = {
  items: DirectoryListItem[];
  query: string;
  initialExpandedId?: string | null;
  parsedPracticeArea?: string;
  parsedLocation?: string;
  className?: string;
};

async function fetchEntityRow(
  item: DirectoryListItem,
): Promise<LegacyGetRow | null> {
  if (item.entityId && item.resultSource) {
    const params = new URLSearchParams({
      entityId: item.entityId,
      source: item.resultSource,
    });
    const res = await fetch(`/api/search/entity?${params.toString()}`);
    if (!res.ok) return null;
    const payload = (await res.json()) as { row?: LegacyGetRow };
    return payload.row ?? null;
  }
  const params = new URLSearchParams({ name: item.businessName });
  const res = await fetch(`/api/search/entity?${params.toString()}`);
  if (!res.ok) return null;
  const payload = (await res.json()) as { row?: LegacyGetRow };
  return payload.row ?? null;
}

export function ExpandableDirectoryList({
  items,
  query,
  initialExpandedId = null,
  parsedPracticeArea,
  parsedLocation,
  className,
}: ExpandableDirectoryListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId);
  const [resolvedRows, setResolvedRows] = useState<Record<string, LegacyGetRow>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const toggleExpand = useCallback(
    async (item: DirectoryListItem, entityId: string) => {
      const next = expandedId === entityId ? null : entityId;
      setExpandedId(next);

      if (next && !item.row && !resolvedRows[entityId]) {
        setLoadingId(entityId);
        try {
          const row = await fetchEntityRow(item);
          if (row) {
            setResolvedRows((prev) => ({ ...prev, [entityId]: row }));
          }
        } finally {
          setLoadingId(null);
        }
      }
    },
    [expandedId, resolvedRows],
  );

  useEffect(() => {
    if (!initialExpandedId) return;
    setExpandedId(initialExpandedId);
    const item = items.find(
      (i) =>
        (i.row && entityIdFromLegacyRow(i.row) === initialExpandedId) ||
        i.entityId === initialExpandedId,
    );
    if (item && !item.row) {
      void fetchEntityRow(item).then((row) => {
        if (row) setResolvedRows((prev) => ({ ...prev, [initialExpandedId]: row }));
      });
    }
  }, [initialExpandedId, items]);

  useEffect(() => {
    if (!expandedId) return;
    document
      .querySelector(`[data-entity-id="${CSS.escape(expandedId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [expandedId]);

  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item, index) => {
        const row = item.row ?? (item.entityId ? resolvedRows[item.entityId] : undefined);
        const entityId =
          row != null
            ? entityIdFromLegacyRow(row)
            : item.entityId ?? `pending:${item.businessName}`;
        const isExpanded = expandedId === entityId;
        const isSra = row?.kind === "adl" && row.sourceType === "sra";
        const summary = row
          ? collapsedDirectorySummary(row)
          : item.subtitle ?? "Tap for contact details";

        return (
          <li
            key={
              row
                ? stableDirectoryRowKey(row)
                : item.entityId ?? `${item.businessName}-${index}`
            }
            data-entity-id={entityId}
          >
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
                onClick={() => void toggleExpand(item, entityId)}
                aria-expanded={isExpanded}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-foreground">
                          {row?.businessName ?? item.businessName}
                        </h4>
                        {isSra ? (
                          <Badge variant="outline" className="border-emerald-600/40 text-emerald-800">
                            SRA
                          </Badge>
                        ) : null}
                        {row?.kind === "adlGroup" ? (
                          <Badge variant="secondary">Legal Aid</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{summary}</p>
                      {!isExpanded ? (
                        <p className="mt-1 text-xs text-primary">Tap for contact details</p>
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
                loadingId === entityId ? (
                  <div className="flex items-center gap-2 border-t border-border/60 bg-muted/20 p-5 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading firm details…
                  </div>
                ) : row ? (
                  <DirectoryResultDetail
                    row={row}
                    explanation={item.explanation}
                    q={query}
                    index={index}
                    parsedPracticeArea={parsedPracticeArea}
                    parsedLocation={parsedLocation}
                  />
                ) : (
                  <div className="border-t border-border/60 bg-muted/20 p-5 text-sm text-muted-foreground">
                    Firm details could not be loaded. Try{" "}
                    <a href={`/search?q=${encodeURIComponent(item.businessName)}`} className="text-primary underline">
                      searching the directory
                    </a>
                    .
                  </div>
                )
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
