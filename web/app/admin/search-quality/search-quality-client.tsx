"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Summary = {
  metrics: {
    periodDays: number;
    directoryInteractions: number;
    noResultRate: number;
    zeroResultInteractions: number;
    mapInteractionRate: number;
    refinementEventRate: number;
    contactCtaRate: number;
    clickThroughRate: number;
    clarificationRate: number;
    fallbackEventCount: number;
  };
  failedPreview: { rawQuery: string; failureKind: string; resultCount: number | null }[];
  suggestions: { title: string; detail: string; href?: string }[];
};

export default function SearchQualityDashboardClient() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/search-quality?action=summary", { cache: "no-store" });
      const json = (await res.json()) as Summary & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Search quality</h1>
          <p className="text-sm text-muted-foreground">
            Telemetry-driven review: failures, taxonomy gaps, source balance, and ranking probes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/failed-searches">Failed searches</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/ranking-analysis">Ranking analysis</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/provider-enrichment">Provider enrichment</Link>
          </Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funnel ({data.metrics.periodDays}d)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Directory interactions: {data.metrics.directoryInteractions}</p>
              <p>Zero-result interactions: {data.metrics.zeroResultInteractions}</p>
              <p>No-result event rate: {data.metrics.noResultRate}</p>
              <p>CTR (clicks / impressions): {data.metrics.clickThroughRate}</p>
              <p>Contact rate: {data.metrics.contactCtaRate}</p>
              <p>Map click rate: {data.metrics.mapInteractionRate}</p>
              <p>Refinement events: {data.metrics.refinementEventRate}</p>
              <p>Clarification rate: {data.metrics.clarificationRate}</p>
              <p>Fallback metadata events: {data.metrics.fallbackEventCount}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Failed search preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.failedPreview.length === 0 ? (
                <p className="text-muted-foreground">No flagged rows in window.</p>
              ) : (
                <ul className="space-y-2">
                  {data.failedPreview.map((r) => (
                    <li key={r.rawQuery + r.failureKind} className="rounded border p-2">
                      <span className="font-medium">{r.failureKind}</span>
                      <span className="text-muted-foreground"> · {r.resultCount ?? 0} results</span>
                      <div className="text-xs text-muted-foreground">{r.rawQuery}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Manual curation hooks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {data.suggestions.map((s) => (
                <div key={s.title} className="rounded-md border p-3">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-muted-foreground">{s.detail}</p>
                  {s.href ? (
                    <Link href={s.href} className="text-primary underline text-sm">
                      Open
                    </Link>
                  ) : null}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Promote production failures to evals: use{" "}
                <code className="rounded bg-muted px-1">/api/admin/search-quality?action=eval-snippet&amp;q=…</code>
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
