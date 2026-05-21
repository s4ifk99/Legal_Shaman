"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type EnrichmentRow = {
  id: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceUrl?: string;
  sourceType: string;
  extractionMethod: string;
  status: string;
};

export default function ProviderEnrichmentAdminClient() {
  const [rows, setRows] = useState<EnrichmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/provider-enrichment", { cache: "no-store" });
      const data = (await res.json()) as { pending: EnrichmentRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.pending ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    const res = await fetch(`/api/admin/provider-enrichment/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      alert(data.error ?? "Action failed");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Provider enrichment review</h1>
          <p className="text-sm text-muted-foreground">
            Approve extracted contact and capability fields before they appear in search results.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
          No pending enrichments.
        </p>
      ) : null}

      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{r.entityId}</p>
                <p className="text-xs text-muted-foreground">
                  {r.entityType} · {r.fieldName} · confidence {(r.confidence * 100).toFixed(0)}%
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => act(r.id, "approve")}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => act(r.id, "reject")}>
                  Reject
                </Button>
              </div>
            </div>
            <p className="mt-2 font-mono text-sm">{r.extractedValue}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Source: {r.sourceType} · {r.extractionMethod}
            </p>
            {r.sourceUrl ? (
              <p className="mt-1 text-xs">
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {r.sourceUrl}
                </a>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
