"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type OpsPayload = {
  health: { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] };
  databaseHostMasked: string | null;
  typesenseHostMasked: string | null;
  catalog: {
    legalEntitiesTotal: number | null;
    sraPostgresCount: number | null;
    sraTypesenseCount: number | null;
    legalAidProviderCount: number | null;
    proBonoIndexedEstimate: number | null;
  };
  pendingEnrichmentCount: number;
  indexingJobCounts: Record<string, number>;
  queuedIndexingJobs: { id: string; entityId: string; entitySource: string; reason: string | null }[];
  failedIndexingJobs: {
    id: string;
    entityId: string;
    entitySource: string;
    lastError: string | null;
    attempts: number;
  }[];
  lastDailyJob: { status: string; completedAt: string; errors?: string[] } | null;
  lastWeeklyJob: { status: string; completedAt: string; errors?: string[] } | null;
  lastIndexBuild: {
    source: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    documentCount: number | null;
    sraCount: number | null;
    errors: string[];
  } | null;
  cliCommands: string[];
};

export default function OpsClient() {
  const [data, setData] = useState<OpsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ops", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as OpsPayload);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <p className="p-6 text-sm text-muted-foreground">Loading ops dashboard…</p>;
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-primary">Operations</h1>
          <p className="text-sm text-muted-foreground">
            Production health, index builds, and scheduled job status. Read-only — run jobs via CLI or cron.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
          <Link href="/admin/users" className="text-sm text-primary hover:underline">
            Users
          </Link>
          <Link href="/admin/provider-enrichment" className="text-sm text-primary hover:underline">
            Enrichment
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Production health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Badge variant={data.health.ok ? "default" : "destructive"}>
            {data.health.ok ? "Healthy" : "Unhealthy"}
          </Badge>
          <ul className="space-y-1">
            {data.health.checks.map((c) => (
              <li key={c.name} className={c.ok ? "text-muted-foreground" : "text-destructive"}>
                {c.name}: {c.ok ? "ok" : c.detail ?? "failed"}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            DB {data.databaseHostMasked ?? "—"} · Typesense {data.typesenseHostMasked ?? "—"}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Catalog counts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>legal_entities (Typesense): {data.catalog.legalEntitiesTotal ?? "—"}</p>
            <p>SRA (Postgres): {data.catalog.sraPostgresCount ?? "—"}</p>
            <p>SRA (Typesense): {data.catalog.sraTypesenseCount ?? "—"}</p>
            <p>Legal aid: {data.catalog.legalAidProviderCount ?? "—"}</p>
            <p>Pro bono (indexed est.): {data.catalog.proBonoIndexedEstimate ?? "—"}</p>
            <p>Pending enrichment reviews: {data.pendingEnrichmentCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Indexing queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {Object.entries(data.indexingJobCounts).map(([k, v]) => (
              <p key={k}>
                {k}: {v}
              </p>
            ))}
            {!Object.keys(data.indexingJobCounts).length ? (
              <p className="text-muted-foreground">No jobs recorded yet.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Last jobs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="font-medium">Daily</p>
            {data.lastDailyJob ? (
              <>
                <p>{data.lastDailyJob.status}</p>
                <p className="text-xs text-muted-foreground">{data.lastDailyJob.completedAt}</p>
              </>
            ) : (
              <p className="text-muted-foreground">Never run</p>
            )}
          </div>
          <div>
            <p className="font-medium">Weekly</p>
            {data.lastWeeklyJob ? (
              <>
                <p>{data.lastWeeklyJob.status}</p>
                <p className="text-xs text-muted-foreground">{data.lastWeeklyJob.completedAt}</p>
              </>
            ) : (
              <p className="text-muted-foreground">Never run</p>
            )}
          </div>
          <div>
            <p className="font-medium">Last index build</p>
            {data.lastIndexBuild ? (
              <>
                <p>
                  {data.lastIndexBuild.source} · {data.lastIndexBuild.status}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.lastIndexBuild.documentCount ?? "?"} docs · SRA {data.lastIndexBuild.sraCount ?? "?"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">No builds recorded</p>
            )}
          </div>
        </CardContent>
      </Card>

      {data.failedIndexingJobs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Failed indexing jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {data.failedIndexingJobs.map((j) => (
                <li key={j.id} className="rounded border p-2">
                  <p className="font-mono text-xs">
                    {j.entityId} ({j.entitySource}) · attempts {j.attempts}
                  </p>
                  <p className="text-destructive">{j.lastError}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CLI commands</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 font-mono text-xs">
            {data.cliCommands.map((cmd) => (
              <li key={cmd} className="rounded bg-muted/50 p-2">
                {cmd}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Production cron: POST /api/admin/jobs/daily and /api/admin/jobs/weekly with header{" "}
            <code>x-admin-secret</code>. See docs/ops/scheduled-refresh.md.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
