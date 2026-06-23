"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TriageResultSection } from "@/lib/legal-search/triage/types";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { DirectoryResultCard } from "@/components/triage/directory-result-card";
import { DirectoryResultDetail } from "@/components/search/directory-result-detail";
import { TriageResultContactLinks } from "@/components/triage/triage-result-contact-links";
import { Card } from "@/components/ui/card";
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

  return (
    <li data-entity-id={result.id}>
      <Card
        className={cn(
          "overflow-hidden transition-shadow",
          isSra ? "border-emerald-500/20" : "border-primary/15",
          isExpanded && "shadow-md ring-2 ring-primary/40",
        )}
      >
        <div className="relative">
          <button
            type="button"
            className="w-full text-left"
            onClick={onToggle}
            aria-expanded={isExpanded}
          >
            <div className="pr-10">
              <DirectoryResultCard result={result} selected={isExpanded} hideContactLinks />
            </div>
            <ChevronDown
              className={cn(
                "pointer-events-none absolute right-4 top-5 h-5 w-5 text-muted-foreground transition-transform",
                isExpanded && "rotate-180",
              )}
            />
          </button>
          <div className="border-t border-border/40 px-4 pb-4">
            <TriageResultContactLinks result={result} />
          </div>
        </div>

        {isExpanded && legacyRow ? (
          <DirectoryResultDetail
            row={legacyRow}
            explanation={result.explanation}
            q={query}
            index={index}
            parsedPracticeArea={parsedPracticeArea}
            parsedLocation={parsedLocation}
          />
        ) : null}

        {isExpanded && !legacyRow ? (
          <div className="border-t border-border/60 bg-muted/20 p-5 text-sm text-muted-foreground">
            Full detail is not available for this listing. Use the contact links above or search again on the{" "}
            <a href="/search" className="text-primary underline">
              directory page
            </a>
            .
          </div>
        ) : null}
      </Card>
    </li>
  );
}
