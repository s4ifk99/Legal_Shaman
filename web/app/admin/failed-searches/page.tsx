"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { FailedSearchRow } from "@/lib/search-quality/types";

type FailedPayload = {
  rows: FailedSearchRow[];
  clusters: { key: string; label: string; hint: string | null; rows: FailedSearchRow[] }[];
};

export default function FailedSearchesAdminPage() {
  const [data, setData] = useState<FailedPayload | null>(null);
  const [replayId, setReplayId] = useState("");
  const [replayJson, setReplayJson] = useState<string | null>(null);
  const [snippetQuery, setSnippetQuery] = useState("");
  const [snippetOut, setSnippetOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/search-quality?action=failed");
      const json = (await res.json()) as FailedPayload & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runReplay = async () => {
    if (!replayId.trim()) return;
    setReplayJson(null);
    const res = await fetch(`/api/admin/search-quality?action=replay&id=${encodeURIComponent(replayId.trim())}`);
    const json = await res.json();
    setReplayJson(JSON.stringify(json, null, 2));
  };

  const genSnippet = async () => {
    if (!snippetQuery.trim()) return;
    const res = await fetch(
      `/api/admin/search-quality?action=eval-snippet&q=${encodeURIComponent(snippetQuery.trim())}`,
    );
    const json = (await res.json()) as { snippet?: string; error?: string };
    setSnippetOut(json.snippet ?? json.error ?? "");
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Failed searches</h1>
          <p className="text-sm text-muted-foreground">
            Zero/low results, low clicks, refinements, and low-confidence directory queries.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/search-quality">Dashboard</Link>
          </Button>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clusters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {data.clusters.map((c) => (
                <div key={c.key} className="rounded-md border p-3">
                  <p className="font-medium">{c.hint ?? c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.rows.length} rows</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent flagged queries</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-2">When</th>
                    <th className="py-2 pr-2">Kind</th>
                    <th className="py-2 pr-2">Query</th>
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2">Taxonomy</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-2 whitespace-nowrap text-xs">{r.createdAt.slice(0, 10)}</td>
                      <td className="py-2 pr-2 text-xs">{r.failureKind}</td>
                      <td className="py-2 pr-2 max-w-md truncate">{r.rawQuery}</td>
                      <td className="py-2 pr-2">{r.resultCount ?? "—"}</td>
                      <td className="py-2 text-xs">{r.parsedTaxonomy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Search replay</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Paste a <code className="rounded bg-muted px-1">search_interactions.id</code> from the table
                above (or DB).
              </p>
              <div className="flex gap-2">
                <Input value={replayId} onChange={(e) => setReplayId(e.target.value)} placeholder="interaction id" />
                <Button type="button" onClick={runReplay}>
                  Load timeline
                </Button>
              </div>
              {replayJson ? (
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{replayJson}</pre>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Eval integration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">Generate a directory eval case stub for `cases.ts`.</p>
              <div className="flex gap-2">
                <Input
                  value={snippetQuery}
                  onChange={(e) => setSnippetQuery(e.target.value)}
                  placeholder="query text"
                />
                <Button type="button" onClick={genSnippet}>
                  Build snippet
                </Button>
              </div>
              {snippetOut ? (
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{snippetOut}</pre>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
