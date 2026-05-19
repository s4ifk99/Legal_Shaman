"use client";

import { ExternalLink } from "lucide-react";
import type { ExternalFallbackPayload } from "@/lib/legal-search/external-fallback/types";
import { EXTERNAL_SECTION_TITLE } from "@/lib/legal-search/external-fallback/types";

type ExternalFallbackSectionProps = {
  payload: ExternalFallbackPayload;
};

export function ExternalFallbackSection({ payload }: ExternalFallbackSectionProps) {
  if (!payload.triggered || !payload.results.length) return null;

  return (
    <section className="space-y-3 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-4">
      <div>
        <h2 className="font-serif text-lg font-semibold text-primary">{EXTERNAL_SECTION_TITLE}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{payload.notice}</p>
      </div>
      <ul className="space-y-3">
        {payload.results.map((r) => (
          <li
            key={r.id}
            className="rounded-md border bg-card p-4 shadow-sm"
            data-external-fallback-id={r.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-medium text-foreground">{r.title}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {r.source.replace(/_/g, " ")}
              </span>
            </div>
            {r.description ? (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.description}</p>
            ) : null}
            {r.location ? (
              <p className="mt-1 text-xs text-muted-foreground">Location hint: {r.location}</p>
            ) : null}
            <p className="mt-3">
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open on official site
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Regulated status: {r.regulatedStatus?.replace(/_/g, " ") ?? "unknown"} · Funding
              type: {r.fundingType?.replace(/_/g, " ") ?? "unknown"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
