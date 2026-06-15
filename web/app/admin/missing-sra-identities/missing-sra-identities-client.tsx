"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type CandidateRow = {
  id: string;
  sraId: string;
  candidateName: string;
  sourceType: string;
  sourceUrl: string;
  evidenceText: string;
  candidatePhone: string;
  candidateAddress: string;
  confidence: number;
  status: string;
  organisation?: {
    displayName: string;
    postcode: string;
    city: string;
  };
};

export default function MissingSraIdentitiesClient() {
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/missing-sra-identities?status=pending_review", {
        cache: "no-store",
      });
      const data = (await res.json()) as { candidates?: CandidateRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRows(data.candidates ?? []);
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
    const res = await fetch(`/api/admin/missing-sra-identities/${id}`, {
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
          <h1 className="font-serif text-2xl font-semibold">Missing SRA Identities</h1>
          <p className="text-sm text-muted-foreground">
            Review recovered firm-name candidates (local SRA, Yell, Serper). Approval updates the
            SRA register row and queues website discovery and re-indexing.
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
          No pending identity candidates.
        </p>
      ) : null}

      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  SRA {r.sraId} → {r.candidateName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Was: {r.organisation?.displayName ?? "—"} · {r.organisation?.postcode}{" "}
                  {r.organisation?.city} · source {r.sourceType} · confidence{" "}
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
            {r.candidatePhone ? (
              <p className="mt-2 text-sm">Phone: {r.candidatePhone}</p>
            ) : null}
            {r.candidateAddress ? (
              <p className="mt-1 text-sm text-muted-foreground">{r.candidateAddress}</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{r.evidenceText}</p>
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
