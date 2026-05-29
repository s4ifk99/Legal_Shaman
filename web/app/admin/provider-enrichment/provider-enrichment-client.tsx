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

type AuditDashboard = {
  enrichment: {
    autoApproved: number;
    auditReview: number;
    manualReview: number;
    rejected: number;
    approved: number;
    bySource: Record<string, number>;
    autoBySource: Record<string, number>;
  };
  calibration: {
    autoApprovedPendingLaterRejection: number;
    avgAutoConfidence: number;
    avgManualConfidence: number;
  };
};

type BulkAction =
  | "bulk_govuk"
  | "bulk_official_contacts"
  | "bulk_high_confidence"
  | "bulk_audit_sample"
  | "bulk_reject_duplicates";

export default function ProviderEnrichmentAdminClient() {
  const [rows, setRows] = useState<EnrichmentRow[]>([]);
  const [dashboard, setDashboard] = useState<AuditDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/provider-enrichment", { cache: "no-store" });
      const data = (await res.json()) as {
        pending: EnrichmentRow[];
        dashboard?: AuditDashboard;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.pending ?? []);
      setDashboard(data.dashboard ?? null);
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

  const runBulk = async (action: BulkAction) => {
    setBulkLoading(true);
    try {
      const res = await fetch("/api/admin/provider-enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as {
        result?: { processed: number; approved: number; rejected: number; skipped: number };
        dashboard?: AuditDashboard;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Bulk action failed");
      if (data.dashboard) setDashboard(data.dashboard);
      const r = data.result;
      if (r) {
        alert(
          `Processed ${r.processed}: approved ${r.approved}, rejected ${r.rejected}, skipped ${r.skipped}`,
        );
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Provider enrichment review</h1>
          <p className="text-sm text-muted-foreground">
            Policy-based auto-approval reduces manual load; audit samples and risky fields still
            need review.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {dashboard ? (
        <section className="rounded-lg border bg-card p-4 text-sm">
          <h2 className="mb-3 font-medium">Approval audit</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Auto-approved" value={dashboard.enrichment.autoApproved} />
            <Stat label="Audit sample queue" value={dashboard.enrichment.auditReview} />
            <Stat label="Manual review" value={dashboard.enrichment.manualReview} />
            <Stat label="Human approved" value={dashboard.enrichment.approved} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Avg confidence — auto: {dashboard.calibration.avgAutoConfidence}, pending:{" "}
            {dashboard.calibration.avgManualConfidence}. Later rejections of auto-approved:{" "}
            {dashboard.calibration.autoApprovedPendingLaterRejection}
          </p>
          {Object.keys(dashboard.enrichment.autoBySource).length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Auto-approval by source:{" "}
              {Object.entries(dashboard.enrichment.autoBySource)
                .map(([k, v]) => `${k} (${v})`)
                .join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={bulkLoading}
          onClick={() => void runBulk("bulk_govuk")}
        >
          Auto-approve GOV.UK fields
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={bulkLoading}
          onClick={() => void runBulk("bulk_official_contacts")}
        >
          Auto-approve official contacts
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={bulkLoading}
          onClick={() => void runBulk("bulk_high_confidence")}
        >
          Approve high-confidence (no conflict)
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={bulkLoading}
          onClick={() => void runBulk("bulk_audit_sample")}
        >
          Send audit sample to review
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={bulkLoading}
          onClick={() => void runBulk("bulk_reject_duplicates")}
        >
          Reject duplicate extras
        </Button>
      </section>

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
                  {r.entityType} · {r.fieldName} · {r.status} · confidence{" "}
                  {(r.confidence * 100).toFixed(0)}%
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-background p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
