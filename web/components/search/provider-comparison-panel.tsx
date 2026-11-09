"use client";

import { useEffect } from "react";
import { captureProductEvent } from "@/components/analytics/posthog-provider";
import type { LegacyGetRow } from "@/lib/legal-search/legacy-get-response";
import { entityIdFromLegacyRow } from "@/lib/search/result-navigation";
import { collapsedDirectorySummary } from "@/lib/search/directory-row-display";

/** Verified fields only. Never invent fees or review scores. */
function costLabel(row: LegacyGetRow): string {
  if (row.kind === "adl" && row.isFree) return "Free";
  if (row.kind === "adl" && row.isLegalAid) return "Legal aid / funded";
  if (row.kind === "adlGroup") return "Legal aid / funded";
  return "Unknown";
}

function reviewLabel(_row: LegacyGetRow): string {
  // Main has no approved review-signal attach path yet. Never invent stars.
  return "Unknown";
}

function locationLabel(row: LegacyGetRow): string {
  if (row.kind === "adl") {
    const parts = [row.city, row.postcode].filter(Boolean);
    if (parts.length) return parts.join(", ");
  }
  if (row.kind === "adlGroup") {
    const loc = row.locations?.[0] as { city?: string; postcode?: string } | undefined;
    const parts = [loc?.city, loc?.postcode].filter(Boolean);
    if (parts.length) return parts.join(", ");
    return "Multiple locations";
  }
  const summary = collapsedDirectorySummary(row);
  return summary.slice(0, 80) || "Unknown";
}

function eligibilityLabel(row: LegacyGetRow): string {
  if (row.kind === "adlGroup") return "Legal aid — eligibility required";
  if (row.kind === "adl" && row.isLegalAid) return "Legal aid — eligibility required";
  if (row.kind === "adl" && row.isFree) return "Free service";
  if (row.kind === "adl" && row.sourceType === "sra") return "Private solicitor (SRA)";
  return "Unknown";
}

type ProviderComparisonPanelProps = {
  rows: LegacyGetRow[];
  maxRows?: number;
};

export function ProviderComparisonPanel({ rows, maxRows = 8 }: ProviderComparisonPanelProps) {
  const slice = rows.slice(0, maxRows);

  useEffect(() => {
    if (slice.length === 0) return;
    captureProductEvent("comparison_viewed", { row_count: slice.length });
  }, [slice.length]);

  if (slice.length === 0) return null;

  return (
    <div className="mb-6 overflow-x-auto rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-serif text-lg font-semibold text-foreground">Compare providers</h2>
        <p className="text-xs text-muted-foreground">
          Verified fields only. Missing cost, reviews, or eligibility show as Unknown.
        </p>
      </div>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Provider</th>
            <th className="px-3 py-2 font-medium">Cost</th>
            <th className="px-3 py-2 font-medium">Reviews</th>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="px-3 py-2 font-medium">Eligibility</th>
          </tr>
        </thead>
        <tbody>
          {slice.map((row) => {
            const id = entityIdFromLegacyRow(row);
            return (
              <tr key={id} className="border-t border-border/70">
                <td className="px-3 py-2 font-medium text-foreground">{row.businessName}</td>
                <td className="px-3 py-2 text-muted-foreground">{costLabel(row)}</td>
                <td className="px-3 py-2 text-muted-foreground">{reviewLabel(row)}</td>
                <td className="px-3 py-2 text-muted-foreground">{locationLabel(row)}</td>
                <td className="px-3 py-2 text-muted-foreground">{eligibilityLabel(row)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
