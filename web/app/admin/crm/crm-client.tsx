"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CrmLeadFields, CrmProspectRow, CrmStage } from "@/lib/admin/crm";

type StageCounts = Record<CrmStage, number>;

type ProspectsPayload = {
  view: "prospects";
  rows: CrmProspectRow[];
  total: number;
  page: number;
  pageSize: number;
  stageCounts: StageCounts;
};

type PipelinePayload = {
  view: "pipeline";
  board: Record<CrmStage, CrmProspectRow[]>;
  stageCounts: StageCounts;
};

type Tab = "prospecting" | "pipeline";

const STAGE_LABEL: Record<CrmStage, string> = {
  cold: "Stage 1 — Cold",
  warm: "Stage 2 — Warm",
  sold: "Stage 3 — Sold",
};

const STAGE_COLOR: Record<CrmStage, string> = {
  cold: "bg-slate-100 text-slate-800 border-slate-300",
  warm: "bg-amber-100 text-amber-900 border-amber-300",
  sold: "bg-emerald-100 text-emerald-900 border-emerald-300",
};

function emptyLeadDraft(): Omit<CrmLeadFields, "createdAt" | "updatedAt" | "lastContactedAt"> & {
  lastContactedAt: string | null;
} {
  return {
    stage: "cold",
    notes: "",
    leadContactName: "",
    leadContactRole: "",
    leadContactEmail: "",
    leadContactPhone: "",
    salesChampionName: "",
    salesChampionRole: "",
    salesChampionEmail: "",
    salesChampionPhone: "",
    salesChampionNotes: "",
    lastContactedAt: null,
  };
}

export default function CrmClient() {
  const [tab, setTab] = useState<Tab>("prospecting");
  const [q, setQ] = useState("");
  const [requirePhone, setRequirePhone] = useState(true);
  const [requireEmail, setRequireEmail] = useState(false);
  const [requireWebsite, setRequireWebsite] = useState(true);
  const [page, setPage] = useState(1);
  const [prospects, setProspects] = useState<ProspectsPayload | null>(null);
  const [pipeline, setPipeline] = useState<PipelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CrmProspectRow | null>(null);
  const [draft, setDraft] = useState(emptyLeadDraft());
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const loadProspects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        view: "prospects",
        page: String(page),
        pageSize: "40",
      });
      if (q.trim()) params.set("q", q.trim());
      if (requirePhone) params.set("requirePhone", "1");
      if (requireEmail) params.set("requireEmail", "1");
      if (requireWebsite) params.set("requireWebsite", "1");
      const res = await fetch(`/api/admin/crm?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProspects(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [page, q, requireEmail, requirePhone, requireWebsite]);

  const loadPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crm?view=pipeline", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPipeline(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "prospecting") void loadProspects();
    else void loadPipeline();
  }, [tab, loadProspects, loadPipeline]);

  function openLead(row: CrmProspectRow) {
    setSelected(row);
    setSaveMsg(null);
    if (row.lead) {
      setDraft({
        stage: row.lead.stage,
        notes: row.lead.notes,
        leadContactName: row.lead.leadContactName,
        leadContactRole: row.lead.leadContactRole,
        leadContactEmail: row.lead.leadContactEmail,
        leadContactPhone: row.lead.leadContactPhone,
        salesChampionName: row.lead.salesChampionName,
        salesChampionRole: row.lead.salesChampionRole,
        salesChampionEmail: row.lead.salesChampionEmail,
        salesChampionPhone: row.lead.salesChampionPhone,
        salesChampionNotes: row.lead.salesChampionNotes,
        lastContactedAt: row.lead.lastContactedAt,
      });
    } else {
      setDraft(emptyLeadDraft());
    }
  }

  async function saveLead(extra?: { stage?: CrmStage; markContacted?: boolean }) {
    if (!selected) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sraId: selected.sraId,
          stage: extra?.stage ?? draft.stage,
          notes: draft.notes,
          leadContactName: draft.leadContactName,
          leadContactRole: draft.leadContactRole,
          leadContactEmail: draft.leadContactEmail,
          leadContactPhone: draft.leadContactPhone,
          salesChampionName: draft.salesChampionName,
          salesChampionRole: draft.salesChampionRole,
          salesChampionEmail: draft.salesChampionEmail,
          salesChampionPhone: draft.salesChampionPhone,
          salesChampionNotes: draft.salesChampionNotes,
          markContacted: extra?.markContacted === true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSaveMsg("Saved");
      if (extra?.stage) setDraft((d) => ({ ...d, stage: extra.stage! }));
      if (tab === "prospecting") await loadProspects();
      else await loadPipeline();
    } catch (e) {
      setSaveMsg(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function quickStart(row: CrmProspectRow) {
    openLead(row);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sraId: row.sraId, stage: "cold" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDraft((d) => ({ ...d, stage: "cold" }));
      setSelected({ ...row, inPipeline: true, stage: "cold", lead: json.lead });
      if (tab === "prospecting") await loadProspects();
      else await loadPipeline();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const stageCounts = useMemo(
    () => prospects?.stageCounts || pipeline?.stageCounts || { cold: 0, warm: 0, sold: 0 },
    [prospects, pipeline],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sales CRM</p>
            <h1 className="text-2xl font-semibold tracking-tight">Law firm pipeline</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Prospect SRA firms, then move leads Cold → Warm → Sold.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/ops">Operations</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/search">Public directory</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-border p-1">
              <Button
                size="sm"
                variant={tab === "prospecting" ? "default" : "ghost"}
                onClick={() => setTab("prospecting")}
              >
                Prospecting
              </Button>
              <Button
                size="sm"
                variant={tab === "pipeline" ? "default" : "ghost"}
                onClick={() => setTab("pipeline")}
              >
                Pipeline
              </Button>
            </div>
            <Badge variant="outline">Cold {stageCounts.cold}</Badge>
            <Badge variant="outline">Warm {stageCounts.warm}</Badge>
            <Badge variant="outline">Sold {stageCounts.sold}</Badge>
          </div>

          {tab === "prospecting" ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Initial prospecting</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Name, website, email, and phone — find firms worth calling, then add them to Cold.
                </p>
                <form
                  className="mt-3 flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPage(1);
                    void loadProspects();
                  }}
                >
                  <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">Search</span>
                    <input
                      className="rounded-md border border-input bg-background px-3 py-2"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Firm name, city, email, phone, SRA ID"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={requireWebsite}
                      onChange={(e) => setRequireWebsite(e.target.checked)}
                    />
                    Website
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={requirePhone}
                      onChange={(e) => setRequirePhone(e.target.checked)}
                    />
                    Phone
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={requireEmail}
                      onChange={(e) => setRequireEmail(e.target.checked)}
                    />
                    Email
                  </label>
                  <Button type="submit" size="sm">
                    Search
                  </Button>
                </form>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading firms…</p>
                ) : error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : !prospects?.rows.length ? (
                  <p className="text-sm text-muted-foreground">No firms match these filters.</p>
                ) : (
                  <>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Showing {(prospects.page - 1) * prospects.pageSize + 1}–
                      {Math.min(prospects.page * prospects.pageSize, prospects.total)} of{" "}
                      {prospects.total.toLocaleString()}
                    </p>
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Company</th>
                            <th className="px-3 py-2 font-medium">Website</th>
                            <th className="px-3 py-2 font-medium">Email</th>
                            <th className="px-3 py-2 font-medium">Phone</th>
                            <th className="px-3 py-2 font-medium">Stage</th>
                            <th className="px-3 py-2 font-medium" />
                          </tr>
                        </thead>
                        <tbody>
                          {prospects.rows.map((row) => (
                            <tr
                              key={row.sraId}
                              className="border-t border-border hover:bg-muted/30"
                            >
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  className="text-left font-medium hover:underline"
                                  onClick={() => openLead(row)}
                                >
                                  {row.name}
                                </button>
                                <div className="text-xs text-muted-foreground">
                                  {[row.city, row.postcode].filter(Boolean).join(" · ") || "—"}
                                </div>
                              </td>
                              <td className="max-w-[160px] truncate px-3 py-2">
                                {row.website ? (
                                  <a
                                    href={row.website}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary hover:underline"
                                  >
                                    {row.website.replace(/^https?:\/\//, "")}
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="max-w-[160px] truncate px-3 py-2">
                                {row.email ? (
                                  <a href={`mailto:${row.email}`} className="hover:underline">
                                    {row.email}
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {row.phone ? (
                                  <a href={`tel:${row.phone}`} className="hover:underline">
                                    {row.phone}
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {row.stage ? (
                                  <span
                                    className={`inline-flex rounded border px-2 py-0.5 text-xs ${STAGE_COLOR[row.stage]}`}
                                  >
                                    {row.stage}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">not in pipeline</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {row.inPipeline ? (
                                  <Button size="sm" variant="outline" onClick={() => openLead(row)}>
                                    Open
                                  </Button>
                                ) : (
                                  <Button size="sm" onClick={() => void quickStart(row)} disabled={saving}>
                                    Add to Cold
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">Page {page}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page * (prospects?.pageSize || 40) >= (prospects?.total || 0)}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {(["cold", "warm", "sold"] as CrmStage[]).map((stage) => (
                <Card key={stage} className={`border ${STAGE_COLOR[stage]}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{STAGE_LABEL[stage]}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {(pipeline?.board[stage] || []).length} leads
                    </p>
                  </CardHeader>
                  <CardContent className="max-h-[70vh] space-y-2 overflow-y-auto">
                    {loading ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : !(pipeline?.board[stage] || []).length ? (
                      <p className="text-xs text-muted-foreground">No leads in this stage.</p>
                    ) : (
                      (pipeline?.board[stage] || []).map((row) => (
                        <button
                          key={row.sraId}
                          type="button"
                          onClick={() => openLead(row)}
                          className="w-full rounded-md border border-border bg-background p-3 text-left hover:bg-muted/40"
                        >
                          <div className="font-medium">{row.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.phone || "No phone"} · {row.email || "No email"}
                          </div>
                          {row.lead?.leadContactName ? (
                            <div className="mt-1 text-xs">
                              Contact: {row.lead.leadContactName}
                              {row.lead.leadContactRole ? ` (${row.lead.leadContactRole})` : ""}
                            </div>
                          ) : null}
                        </button>
                      ))
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {selected ? selected.name : "Lead details"}
              </CardTitle>
              {selected ? (
                <p className="text-xs text-muted-foreground">
                  SRA {selected.sraId}
                  {selected.city ? ` · ${selected.city}` : ""}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a firm to add notes, contacts, and move stages.
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!selected ? null : (
                <>
                  <div className="space-y-1 text-sm">
                    <div>
                      <span className="text-muted-foreground">Website: </span>
                      {selected.website ? (
                        <a
                          href={selected.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {selected.website}
                        </a>
                      ) : (
                        "—"
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Email: </span>
                      {selected.email || "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Phone: </span>
                      {selected.phone || "—"}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Funnel stage
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(["cold", "warm", "sold"] as CrmStage[]).map((stage) => (
                        <Button
                          key={stage}
                          size="sm"
                          variant={draft.stage === stage ? "default" : "outline"}
                          disabled={saving}
                          onClick={() => void saveLead({ stage })}
                        >
                          {stage}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Notes</span>
                    <textarea
                      className="min-h-[110px] w-full rounded-md border border-input bg-background px-3 py-2"
                      value={draft.notes}
                      onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                      placeholder="Call outcomes, next steps, objections…"
                    />
                  </label>

                  <fieldset className="space-y-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Lead contact (spoke to)
                    </legend>
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Name"
                      value={draft.leadContactName}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, leadContactName: e.target.value }))
                      }
                    />
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Role / title"
                      value={draft.leadContactRole}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, leadContactRole: e.target.value }))
                      }
                    />
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Email"
                      value={draft.leadContactEmail}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, leadContactEmail: e.target.value }))
                      }
                    />
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Phone"
                      value={draft.leadContactPhone}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, leadContactPhone: e.target.value }))
                      }
                    />
                  </fieldset>

                  <fieldset className="space-y-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Sales champion
                    </legend>
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Name"
                      value={draft.salesChampionName}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, salesChampionName: e.target.value }))
                      }
                    />
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Role / title"
                      value={draft.salesChampionRole}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, salesChampionRole: e.target.value }))
                      }
                    />
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Email"
                      value={draft.salesChampionEmail}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, salesChampionEmail: e.target.value }))
                      }
                    />
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Phone"
                      value={draft.salesChampionPhone}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, salesChampionPhone: e.target.value }))
                      }
                    />
                    <textarea
                      className="min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="Champion notes / buying signs"
                      value={draft.salesChampionNotes}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, salesChampionNotes: e.target.value }))
                      }
                    />
                  </fieldset>

                  <div className="flex flex-wrap gap-2">
                    <Button disabled={saving} onClick={() => void saveLead()}>
                      {saving ? "Saving…" : "Save details"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => void saveLead({ markContacted: true })}
                    >
                      Mark contacted
                    </Button>
                    {!selected.inPipeline ? (
                      <Button
                        variant="secondary"
                        disabled={saving}
                        onClick={() => void saveLead({ stage: "cold" })}
                      >
                        Add to Cold
                      </Button>
                    ) : null}
                  </div>
                  {saveMsg ? (
                    <p className="text-xs text-muted-foreground">{saveMsg}</p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
