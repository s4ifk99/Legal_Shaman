"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function formatMetric(value: number | null | undefined, unavailableLabel = "unavailable"): string {
  if (value == null) return unavailableLabel;
  return String(value);
}

type CoveragePayload = {
  reportValid?: boolean;
  degraded?: boolean;
  dataSources?: {
    sraOrganisations: { ok: boolean; rowsLoaded: number; error?: string };
    providerEnrichments: { ok: boolean; rowsLoaded: number; error?: string };
  };
  health?: {
    expectedSraRows: number | null;
    loadedSraRows: number;
    expectedEnrichmentRows: number | null;
    loadedEnrichmentRows: number;
    warnings: string[];
  };
  report: {
    reportValid: boolean;
    degraded: boolean;
    weak: {
      totalWeak: number | null;
      totalScanned: number | null;
      unavailable?: boolean;
      reason?: string;
      weakByReason: Record<string, number>;
      weakByPracticeArea: Record<string, number>;
    };
    ladderStatusCounts: Record<string, number> | null;
    missingContact: {
      noPhone: number | null;
      noEmail: number | null;
      noWebsite: number | null;
      reason?: string;
    };
    missingPracticeArea: number | null;
    pendingReviewEnrichments: number | null;
    pendingReviewExtracted: number | null;
    yellMetrics?: {
      yellContactCandidates: number;
      yellAutoApprovedContacts: number;
      yellPendingContacts: number;
      yellRejectedIdentityCandidates: number;
      yellTownsScanned: number;
    } | null;
    dataSources?: CoveragePayload["dataSources"];
    health?: CoveragePayload["health"];
  };
  topPriority: {
    id: string;
    title: string;
    city?: string;
    postcode?: string;
    priorityScore: number;
    reasons: string[];
    website?: string;
  }[];
  pendingWebsites: PendingRow[];
  pendingContacts: PendingRow[];
  pendingPractice: PendingRow[];
};

type PendingRow = {
  id: string;
  entityId: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceUrl?: string | null;
  sourceType: string;
  status: string;
};

export default function ProviderCoverageClient() {
  const [data, setData] = useState<CoveragePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/provider-coverage", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(
    id: string,
    action: "approve" | "reject",
    source: "enrichment" | "extracted",
  ) {
    await fetch("/api/admin/provider-coverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, source }),
    });
    await load();
  }

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading coverage…</p>;
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!data) return null;

  const { report } = data;
  const scanned = report.weak.totalScanned;
  const weakCount = report.weak.totalWeak;
  const weakPct =
    scanned != null && weakCount != null && scanned > 0
      ? Math.round((weakCount / scanned) * 100)
      : null;
  const pendingReview =
    report.pendingReviewEnrichments != null && report.pendingReviewExtracted != null
      ? report.pendingReviewEnrichments + report.pendingReviewExtracted
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Provider coverage</h1>
          <p className="text-sm text-muted-foreground">
            SRA enrichment ladder — weak providers, missing contact, practice-area gaps.
          </p>
          {!report.reportValid && (
            <p className="mt-2 text-sm font-medium text-destructive">
              Coverage report incomplete — data could not be loaded reliably.
            </p>
          )}
          {report.degraded && report.reportValid && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              Degraded: some datasources missing or below expected volume.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/missing-sra-identities">Missing SRA identities</Link>
            {" · "}
            <Link href="/admin/yell-enrichment">Yell enrichment</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/provider-crawler">Crawler review</Link>
          </Button>
        </div>
      </div>

      {(report.dataSources || report.health) && (
        <section className="rounded-lg border border-dashed p-4 text-sm">
          <h2 className="mb-2 font-medium">Data sources</h2>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              SRA organisations:{" "}
              {report.dataSources?.sraOrganisations.ok ? "ok" : "failed"} (
              {report.dataSources?.sraOrganisations.rowsLoaded ?? report.health?.loadedSraRows ?? 0}{" "}
              loaded
              {report.health?.expectedSraRows != null
                ? ` / ${report.health.expectedSraRows} expected`
                : ""}
              )
            </li>
            <li>
              Provider enrichments:{" "}
              {report.dataSources?.providerEnrichments.ok ? "ok" : "failed"} (
              {report.dataSources?.providerEnrichments.rowsLoaded ??
                report.health?.loadedEnrichmentRows ??
                0}{" "}
              loaded)
            </li>
          </ul>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="SRA scanned" value={formatMetric(scanned)} />
        <StatCard
          label="Weak providers"
          value={
            weakPct != null
              ? `${formatMetric(weakCount)} (${weakPct}%)`
              : formatMetric(weakCount)
          }
        />
        <StatCard label="Missing practice area" value={formatMetric(report.missingPracticeArea)} />
        <StatCard label="Pending review" value={formatMetric(pendingReview)} />
      </section>

      {report.yellMetrics ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Yell enrichment</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">
              Contact candidates: {report.yellMetrics.yellContactCandidates}
            </Badge>
            <Badge variant="secondary">
              Auto-approved: {report.yellMetrics.yellAutoApprovedContacts}
            </Badge>
            <Badge variant="secondary">
              Pending: {report.yellMetrics.yellPendingContacts}
            </Badge>
            <Badge variant="secondary">
              Rejected identity: {report.yellMetrics.yellRejectedIdentityCandidates}
            </Badge>
            <Badge variant="secondary">
              Towns scanned: {report.yellMetrics.yellTownsScanned}
            </Badge>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Missing contact (SRA)</h2>
        {report.missingContact.reason && (
          <p className="mb-2 text-xs text-muted-foreground">{report.missingContact.reason}</p>
        )}
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">
            No phone: {formatMetric(report.missingContact.noPhone)}
          </Badge>
          <Badge variant="secondary">
            No email: {formatMetric(report.missingContact.noEmail)}
          </Badge>
          <Badge variant="secondary">
            No website: {formatMetric(report.missingContact.noWebsite)}
          </Badge>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Ladder status</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {report.ladderStatusCounts &&
            Object.entries(report.ladderStatusCounts).map(([k, v]) => (
            <Badge key={k} variant="outline">
              {k}: {v}
            </Badge>
            ))}
          {(!report.ladderStatusCounts ||
            !Object.keys(report.ladderStatusCounts).length) && (
            <span className="text-muted-foreground">
              {report.ladderStatusCounts === null
                ? "Ladder status unavailable."
                : "No ladder runs recorded yet."}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Top priority weak providers</h2>
        <ul className="space-y-2 text-sm">
          {data.topPriority.slice(0, 15).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 border-b py-2">
              <span className="font-medium">{p.title}</span>
              <span className="text-muted-foreground">{p.city ?? ""}</span>
              <Badge variant="outline">score {p.priorityScore.toFixed(2)}</Badge>
              <span className="text-xs text-muted-foreground">{p.reasons.join(", ")}</span>
            </li>
          ))}
        </ul>
      </section>

      <PendingSection
        title="Websites pending approval"
        rows={data.pendingWebsites}
        source="enrichment"
        onDecide={decide}
      />
      <PendingSection
        title="Contacts pending approval"
        rows={data.pendingContacts}
        source="enrichment"
        onDecide={decide}
      />
      <PendingSection
        title="Practice areas pending approval"
        rows={data.pendingPractice}
        source="extracted"
        onDecide={decide}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function PendingSection({
  title,
  rows,
  source,
  onDecide,
}: {
  title: string;
  rows: PendingRow[];
  source: "enrichment" | "extracted";
  onDecide: (id: string, action: "approve" | "reject", source: "enrichment" | "extracted") => void;
}) {
  if (!rows.length) return null;
  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 font-medium">{title}</h2>
      <ul className="space-y-3 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="rounded border p-3">
            <div className="font-medium">{r.entityId}</div>
            <div>
              {r.fieldName}: {r.extractedValue.slice(0, 120)}
            </div>
            <div className="text-xs text-muted-foreground">
              conf={r.confidence.toFixed(2)} · {r.sourceType}
              {r.sourceUrl ? (
                <>
                  {" "}
                  ·{" "}
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                    source
                  </a>
                </>
              ) : null}
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => onDecide(r.id, "approve", source)}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecide(r.id, "reject", source)}>
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
