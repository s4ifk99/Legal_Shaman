"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type YellEnrichmentRow = {
  id: string;
  entityId: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceUrl?: string;
  status: string;
  approvedProviderName: string;
  matchScore: number;
};

type YellMetrics = {
  yellContactCandidates: number;
  yellAutoApprovedContacts: number;
  yellPendingContacts: number;
  yellRejectedIdentityCandidates: number;
  yellTownsScanned: number;
};

export default function YellEnrichmentClient() {
  const [rows, setRows] = useState<YellEnrichmentRow[]>([]);
  const [metrics, setMetrics] = useState<YellMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/yell-enrichment?status=pending_review", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        enrichments?: YellEnrichmentRow[];
        metrics?: YellMetrics | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.enrichments ?? []);
      setMetrics(data.metrics ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    const res = await fetch("/api/admin/yell-enrichment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
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
          <h1 className="font-serif text-2xl font-semibold">Yell contact enrichment</h1>
          <p className="text-sm text-muted-foreground">
            Review Yell-sourced phone, website, and address for providers with approved firm names.
            Yell is not used for SRA identity recovery by default.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/provider-coverage">Coverage</Link>
          </Button>
        </div>
      </div>

      {metrics ? (
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <div className="rounded-md border p-3">Contacts: {metrics.yellContactCandidates}</div>
          <div className="rounded-md border p-3">Auto-approved: {metrics.yellAutoApprovedContacts}</div>
          <div className="rounded-md border p-3">Pending: {metrics.yellPendingContacts}</div>
          <div className="rounded-md border p-3">
            Rejected identity: {metrics.yellRejectedIdentityCandidates}
          </div>
          <div className="rounded-md border p-3">Towns scanned: {metrics.yellTownsScanned}</div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
          No pending Yell enrichments.
        </p>
      ) : null}

      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {r.entityId} · {r.fieldName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Approved firm: {r.approvedProviderName || "—"} · match{" "}
                  {(r.matchScore * 100).toFixed(0)}% · confidence{" "}
                  {(r.confidence * 100).toFixed(0)}%
                </p>
                <p className="mt-1 text-sm">{r.extractedValue}</p>
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
            {r.sourceUrl ? (
              <p className="mt-2 text-xs">
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
