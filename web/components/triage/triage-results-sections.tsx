"use client";

import type { TriageResultSection } from "@/lib/legal-search/triage/types";
import { DirectoryResultCard } from "@/components/triage/directory-result-card";

type TriageResultsSectionsProps = {
  sections: TriageResultSection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function TriageResultsSections({
  sections,
  selectedId,
  onSelect,
}: TriageResultsSectionsProps) {
  if (!sections.length) {
    return (
      <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
        No providers matched yet. Try widening your search or adjusting funding preference.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.kind} className="space-y-3">
          <h2 className="font-serif text-lg font-semibold text-primary">{section.title}</h2>
          <div className="space-y-3">
            {section.results.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                onClick={() => onSelect(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(r.id);
                  }
                }}
              >
                <DirectoryResultCard result={r} selected={selectedId === r.id} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
