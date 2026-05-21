"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type ExtractedRow = {
  id: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceUrl?: string;
  sourceType: string;
  extractionMethod: string;
  reviewCategory: string;
  status: string;
  extractedAt: string;
};

type CrawlJob = {
  id: string;
  entityId: string;
  entityType: string;
  mode: string;
  status: string;
  targetUrl: string | null;
  scheduledAt: string;
};

type LoadMeta = {
  dbRowCount: number;
  pendingRowCount: number;
  environment: string;
  vercelEnv: string | null;
  nodeEnv: string;
  databaseHost: string | null;
  serverFetchedAt: string;
};

export default function ProviderCrawlerAdminClient() {
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [meta, setMeta] = useState<LoadMeta | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "field" | "testimonial" | "review_signal">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueEntityId, setQueueEntityId] = useState("");
  const [queueEntityType, setQueueEntityType] = useState("firm");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        filter === "all" ? "" : `?reviewCategory=${encodeURIComponent(filter)}`;
      const res = await fetch(`/api/admin/provider-crawler${qs}`, { cache: "no-store" });
      const data = (await res.json()) as {
        pending: ExtractedRow[];
        queuedJobs: CrawlJob[];
        meta?: LoadMeta;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.pending ?? []);
      setJobs(data.queuedJobs ?? []);
      setMeta(data.meta ?? null);
      setLastFetchedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    const res = await fetch(`/api/admin/provider-crawler/${id}`, {
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

  const queueJob = async () => {
    if (!queueEntityId.trim()) return;
    const res = await fetch("/api/admin/provider-crawler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        action: "queue",
        entityId: queueEntityId.trim(),
        entityType: queueEntityType.trim(),
        mode: "all",
      }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      alert(data.error ?? "Queue failed");
      return;
    }
    setQueueEntityId("");
    load();
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Provider crawler</h1>
          <p className="text-sm text-muted-foreground">
            Review extracted fields before they appear in search. Testimonials and review signals are
            approved separately from contact data.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <section className="rounded-lg border bg-muted/30 p-3 font-mono text-xs text-muted-foreground space-y-1">
        <p className="font-sans text-sm font-medium text-foreground">Freshness debug</p>
        <p>Pending rows shown: {rows.length}</p>
        <p>
          DB rows (total / pending_review):{" "}
          {meta
            ? `${meta.dbRowCount} / ${meta.pendingRowCount}`
            : loading
              ? "…"
              : "—"}
        </p>
        <p>
          Last fetched (client):{" "}
          {lastFetchedAt ? new Date(lastFetchedAt).toLocaleString() : "—"}
        </p>
        <p>
          Server fetched at:{" "}
          {meta?.serverFetchedAt
            ? new Date(meta.serverFetchedAt).toLocaleString()
            : "—"}
        </p>
        <p>
          Environment: {meta?.environment ?? "—"}
          {meta?.vercelEnv ? ` (VERCEL_ENV=${meta.vercelEnv})` : ""}
          {meta ? ` · NODE_ENV=${meta.nodeEnv}` : ""}
        </p>
        <p>DATABASE_URL host: {meta?.databaseHost ?? "(not set or unparseable)"}</p>
      </section>

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Queue crawl job</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-[200px] flex-1 rounded-md border px-3 py-2 text-sm"
            placeholder="entity id (e.g. firm:abc)"
            value={queueEntityId}
            onChange={(e) => setQueueEntityId(e.target.value)}
          />
          <input
            className="w-40 rounded-md border px-3 py-2 text-sm"
            placeholder="entity type"
            value={queueEntityType}
            onChange={(e) => setQueueEntityType(e.target.value)}
          />
          <Button size="sm" onClick={queueJob}>
            Queue
          </Button>
        </div>
        {jobs.length > 0 ? (
          <p className="text-xs text-muted-foreground">{jobs.length} job(s) queued — run npm run providers:crawl</p>
        ) : null}
      </section>

      <div className="flex gap-2">
        {(["all", "field", "testimonial", "review_signal"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All pending" : f}
          </Button>
        ))}
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
          No pending extracted fields.
        </p>
      ) : null}

      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{r.entityId}</p>
                <p className="text-xs text-muted-foreground">
                  {r.entityType} · {r.fieldName} · {r.reviewCategory} · confidence{" "}
                  {(r.confidence * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Extracted {new Date(r.extractedAt).toLocaleString()}
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
            <p className="mt-2 font-mono text-sm break-all">{r.extractedValue}</p>
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
