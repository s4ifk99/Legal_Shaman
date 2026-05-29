"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type CoveragePayload = {
  report: {
    weak: {
      totalWeak: number;
      totalScanned: number;
      weakByReason: Record<string, number>;
      weakByPracticeArea: Record<string, number>;
    };
    ladderStatusCounts: Record<string, number>;
    missingContact: { noPhone: number; noEmail: number; noWebsite: number };
    missingPracticeArea: number;
    pendingReviewEnrichments: number;
    pendingReviewExtracted: number;
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
  const weakPct = report.weak.totalScanned
    ? Math.round((report.weak.totalWeak / report.weak.totalScanned) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Provider coverage</h1>
          <p className="text-sm text-muted-foreground">
            SRA enrichment ladder — weak providers, missing contact, practice-area gaps.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/provider-crawler">Crawler review</Link>
          </Button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="SRA scanned" value={String(report.weak.totalScanned)} />
        <StatCard label="Weak providers" value={`${report.weak.totalWeak} (${weakPct}%)`} />
        <StatCard label="Missing practice area" value={String(report.missingPracticeArea)} />
        <StatCard
          label="Pending review"
          value={String(report.pendingReviewEnrichments + report.pendingReviewExtracted)}
        />
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Missing contact (SRA)</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">No phone: {report.missingContact.noPhone}</Badge>
          <Badge variant="secondary">No email: {report.missingContact.noEmail}</Badge>
          <Badge variant="secondary">No website: {report.missingContact.noWebsite}</Badge>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Ladder status</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(report.ladderStatusCounts).map(([k, v]) => (
            <Badge key={k} variant="outline">
              {k}: {v}
            </Badge>
          ))}
          {!Object.keys(report.ladderStatusCounts).length && (
            <span className="text-muted-foreground">No ladder runs recorded yet.</span>
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
