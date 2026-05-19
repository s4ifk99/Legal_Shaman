"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DirectorySearchResponse } from "@/lib/legal-search/types";

export default function RankingAnalysisAdminPage() {
  const [query, setQuery] = useState("employment tribunal unfair dismissal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DirectorySearchResponse | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setPayload(null);
    try {
      const res = await fetch("/api/admin/search-quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), limit: 20 }),
      });
      const json = (await res.json()) as DirectorySearchResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Probe failed");
      setPayload(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Ranking analysis</h1>
          <p className="text-sm text-muted-foreground">
            Runs directory search with debug + pipeline stage snapshots (top 20 at each step).
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/search-quality">Dashboard</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Probe query</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Input className="max-w-xl flex-1" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button onClick={run} disabled={loading || !query.trim()}>
            {loading ? "Running…" : "Run probe"}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {payload?.searchDebug ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Response-level diagnostics</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>Taxonomy: {payload.searchDebug.taxonomyMatch?.slug ?? "—"}</p>
              <p>Confidence: {payload.searchDebug.queryConfidence ?? "—"}</p>
              <p>Source diversity applied: {String(payload.searchDebug.sourceDiversityApplied)}</p>
              <p>Legal aid boost: {String(payload.searchDebug.legalAidBoostApplied)}</p>
              <p>{payload.searchDebug.legalAidBoostReason ?? ""}</p>
              <p>Initial hits: {payload.searchDebug.initialTypesenseHitCount ?? "—"}</p>
              <p>Final count: {payload.searchDebug.finalHitCount ?? payload.results.length}</p>
            </CardContent>
          </Card>

          {payload.searchDebug.rankingStages?.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ranking stages (top 20)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {payload.searchDebug.rankingStages.map((st) => (
                  <div key={st.stage}>
                    <p className="mb-1 text-sm font-medium">{st.stage}</p>
                    <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                      {JSON.stringify(st.top, null, 2)}
                    </pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Final results + per-hit debug</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[480px] overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(
                  payload.results.map((r) => ({
                    id: r.id,
                    title: r.title,
                    source: r.source,
                    scores: r.scores,
                    debug: r.debug,
                  })),
                  null,
                  2,
                )}
              </pre>
            </CardContent>
          </Card>
        </div>
      ) : payload && !payload.searchDebug ? (
        <p className="text-sm text-muted-foreground">
          No search debug returned (legacy engine or Typesense disabled). Enable unified directory +
          run from an environment with Typesense configured.
        </p>
      ) : null}
    </main>
  );
}
