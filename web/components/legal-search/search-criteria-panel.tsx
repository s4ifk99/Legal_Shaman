"use client";

import { cn } from "@/lib/utils";
import type { SearchCriterion, SearchCriterionKind } from "@/lib/legal-knowledge/types";

const KIND_STYLES: Record<
  SearchCriterionKind,
  { border: string; bg: string; label: string }
> = {
  legal_issue: {
    border: "border-l-violet-500",
    bg: "bg-violet-500/5",
    label: "text-violet-700 dark:text-violet-300",
  },
  situation: {
    border: "border-l-orange-500",
    bg: "bg-orange-500/5",
    label: "text-orange-700 dark:text-orange-300",
  },
  jurisdiction: {
    border: "border-l-sky-500",
    bg: "bg-sky-500/5",
    label: "text-sky-700 dark:text-sky-300",
  },
  location: {
    border: "border-l-blue-500",
    bg: "bg-blue-500/5",
    label: "text-blue-700 dark:text-blue-300",
  },
  urgency: {
    border: "border-l-rose-500",
    bg: "bg-rose-500/5",
    label: "text-rose-700 dark:text-rose-300",
  },
  help_route: {
    border: "border-l-pink-500",
    bg: "bg-pink-500/5",
    label: "text-pink-700 dark:text-pink-300",
  },
  sources: {
    border: "border-l-emerald-500",
    bg: "bg-emerald-500/5",
    label: "text-emerald-700 dark:text-emerald-300",
  },
  retrieval: {
    border: "border-l-slate-400",
    bg: "bg-muted/40",
    label: "text-muted-foreground",
  },
  routes: {
    border: "border-l-teal-500",
    bg: "bg-teal-500/5",
    label: "text-teal-700 dark:text-teal-300",
  },
};

type SearchCriteriaPanelProps = {
  query: string;
  criteria: SearchCriterion[];
  loading?: boolean;
  className?: string;
};

export function SearchCriteriaPanel({
  query,
  criteria,
  loading = false,
  className,
}: SearchCriteriaPanelProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Criteria</h2>
        <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground">
          UK legal search
        </span>
      </div>

      <div className="space-y-0 divide-y divide-border/60">
        <div className="px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground">{query || "Enter your legal problem…"}</p>
        </div>

        {loading && criteria.length === 0 ? (
          <div className="space-y-2 px-4 py-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : (
          criteria.map((item) => {
            const style = KIND_STYLES[item.kind];
            return (
              <div
                key={item.id}
                className={cn(
                  "border-l-4",
                  style.border,
                  style.bg,
                  item.emphasis === "high" && "ring-1 ring-inset ring-border/40",
                )}
              >
                <div className="min-w-0 flex-1 px-4 py-3">
                  <p className={cn("text-[11px] font-semibold uppercase tracking-wide", style.label)}>
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-foreground">{item.text}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
