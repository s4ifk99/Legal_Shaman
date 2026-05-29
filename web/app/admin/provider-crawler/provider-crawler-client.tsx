"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  AdminProviderGroup,
  AdminReviewItem,
  AdminReviewPayload,
  DuplicateCluster,
} from "@/lib/provider-crawler/admin-review";
import { PracticeAreaCanonicalChips, ReviewItemRow, fieldLabel } from "./review-format";
import { ChevronDown, ExternalLink } from "lucide-react";

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

type PriorityTab =
  | "all"
  | "high_confidence"
  | "urgent_contact"
  | "testimonials"
  | "low_confidence"
  | "duplicates"
  | "manual";

type PendingAgeFilter = "all" | "1h" | "24h" | "7d" | "30d";

const PENDING_AGE_MS: Record<Exclude<PendingAgeFilter, "all">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const PRIORITY_TABS: { id: PriorityTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "high_confidence", label: "High confidence" },
  { id: "urgent_contact", label: "Urgent contact" },
  { id: "testimonials", label: "Testimonials" },
  { id: "low_confidence", label: "Low confidence" },
  { id: "duplicates", label: "Duplicate candidates" },
  { id: "manual", label: "Needs manual review" },
];

function itemMatchesTab(item: AdminReviewItem, tab: PriorityTab): boolean {
  if (tab === "all") return true;
  if (tab === "high_confidence") return item.flags.highConfidence;
  if (tab === "urgent_contact") return item.flags.urgentContact;
  if (tab === "testimonials") return item.flags.testimonial;
  if (tab === "low_confidence") return item.flags.lowConfidence;
  if (tab === "duplicates") return item.flags.duplicateCandidate;
  if (tab === "manual") return item.flags.needsManualReview;
  return true;
}

function removeIdsFromReview(review: AdminReviewPayload, ids: Set<string>): AdminReviewPayload {
  const providers: AdminProviderGroup[] = [];
  for (const p of review.providers) {
    const sections = p.sections
      .map((s) => ({
        ...s,
        items: s.items.filter((i) => !ids.has(i.id)),
      }))
      .filter((s) => s.items.length > 0);
    if (sections.length === 0) continue;
    const items = sections.flatMap((s) => s.items);
    providers.push({
      ...p,
      sections,
      itemCount: items.length,
      maxConfidencePct: Math.max(...items.map((i) => i.confidencePct)),
    });
  }
  const duplicateClusters = review.duplicateClusters
    .map((c) => ({
      ...c,
      itemIds: c.itemIds.filter((id) => !ids.has(id)),
    }))
    .filter((c) => c.itemIds.length >= 2);
  return {
    ...review,
    providers,
    duplicateClusters,
    metrics: {
      ...review.metrics,
      reviewableCount: Math.max(0, review.metrics.reviewableCount - ids.size),
    },
    allItemIds: review.allItemIds.filter((id) => !ids.has(id)),
  };
}

function itemWithinPendingAge(item: AdminReviewItem, pendingAge: PendingAgeFilter): boolean {
  if (pendingAge === "all") return true;
  const maxMs = PENDING_AGE_MS[pendingAge];
  const age = Date.now() - new Date(item.extractedAt).getTime();
  return age <= maxMs;
}

function filterProviders(
  providers: AdminProviderGroup[],
  tab: PriorityTab,
  search: string,
  fieldType: string,
  source: string,
  minConfidence: number,
  practiceArea: string,
  pendingAge: PendingAgeFilter,
): AdminProviderGroup[] {
  const q = search.trim().toLowerCase();
  const pa = practiceArea.trim().toLowerCase();

  return providers
    .map((p) => {
      const sections = p.sections
        .map((s) => ({
          ...s,
          items: s.items.filter((item) => {
            if (!itemMatchesTab(item, tab)) return false;
            if (fieldType !== "all" && item.fieldName !== fieldType) return false;
            if (source !== "all" && item.sourceType !== source) return false;
            if (item.confidencePct < minConfidence) return false;
            if (!itemWithinPendingAge(item, pendingAge)) return false;
            if (pa && !item.extractedValue.toLowerCase().includes(pa)) return false;
            if (q) {
              const hay = [
                p.label,
                p.entityId,
                item.fieldName,
                item.extractedValue,
                item.currentValue ?? "",
                item.sourceType,
              ]
                .join(" ")
                .toLowerCase();
              if (!hay.includes(q)) return false;
            }
            return true;
          }),
        }))
        .filter((s) => s.items.length > 0);
      if (sections.length === 0) return null;
      const items = sections.flatMap((s) => s.items);
      return {
        ...p,
        sections,
        itemCount: items.length,
        maxConfidencePct: Math.max(...items.map((i) => i.confidencePct)),
      };
    })
    .filter((p): p is AdminProviderGroup => p !== null);
}

export default function ProviderCrawlerAdminClient() {
  const [review, setReview] = useState<AdminReviewPayload | null>(null);
  const [jobs, setJobs] = useState<CrawlJob[]>([]);
  const [meta, setMeta] = useState<LoadMeta | null>(null);
  const [pendingRaw, setPendingRaw] = useState<ExtractedRow[]>([]);
  const [activeTab, setActiveTab] = useState<PriorityTab>("all");
  const [search, setSearch] = useState("");
  const [fieldType, setFieldType] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [minConfidence, setMinConfidence] = useState(0);
  const [practiceArea, setPracticeArea] = useState("");
  const [pendingAge, setPendingAge] = useState<PendingAgeFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueEntityId, setQueueEntityId] = useState("");
  const [queueEntityType, setQueueEntityType] = useState("firm");
  const [bulkBusy, setBulkBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/provider-crawler", { cache: "no-store" });
      const data = (await res.json()) as {
        pending: ExtractedRow[];
        queuedJobs: CrawlJob[];
        review?: AdminReviewPayload;
        meta?: LoadMeta;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setPendingRaw(data.pending ?? []);
      setJobs(data.queuedJobs ?? []);
      setMeta(data.meta ?? null);
      setReview(data.review ?? null);
      setSelected(new Set());
      if (data.review?.providers.length) {
        setExpandedProviders(new Set([data.review.providers[0]!.entityId]));
        const first = data.review.providers[0]?.sections[0]?.items[0];
        setFocusId(first?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fieldTypes = useMemo(() => {
    if (!review) return [];
    const set = new Set<string>();
    for (const p of review.providers) {
      for (const s of p.sections) {
        for (const i of s.items) set.add(i.fieldName);
      }
    }
    return [...set].sort();
  }, [review]);

  const sources = useMemo(() => {
    if (!review) return [];
    const set = new Set<string>();
    for (const p of review.providers) {
      for (const s of p.sections) {
        for (const i of s.items) set.add(i.sourceType);
      }
    }
    return [...set].sort();
  }, [review]);

  const filteredProviders = useMemo(() => {
    if (!review) return [];
    return filterProviders(
      review.providers,
      activeTab,
      search,
      fieldType,
      sourceFilter,
      minConfidence,
      practiceArea,
      pendingAge,
    );
  }, [review, activeTab, search, fieldType, sourceFilter, minConfidence, practiceArea, pendingAge]);

  const flatItems = useMemo(() => {
    const out: AdminReviewItem[] = [];
    for (const p of filteredProviders) {
      for (const s of p.sections) out.push(...s.items);
    }
    return out;
  }, [filteredProviders]);

  const filteredDuplicateClusters = useMemo(() => {
    if (!review) return [];
    const visibleIds = new Set(flatItems.map((i) => i.id));
    return review.duplicateClusters.filter((c) =>
      c.itemIds.some((id) => visibleIds.has(id)),
    );
  }, [review, flatItems]);

  const focusItem = focusId ? flatItems.find((i) => i.id === focusId) : null;
  const focusIndex = focusId ? flatItems.findIndex((i) => i.id === focusId) : -1;

  const bulkAct = useCallback(async (ids: string[], decision: "approve" | "reject") => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    const idSet = new Set(ids);
    setReview((r) => (r ? removeIdsFromReview(r, idSet) : r));
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) next.delete(id);
      return next;
    });
    try {
      const res = await fetch("/api/admin/provider-crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "bulk", ids, decision }),
      });
      const data = (await res.json()) as { failed?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Bulk action failed");
      if (data.failed?.length) {
        void load();
        alert(`${data.failed.length} item(s) could not be updated — list refreshed.`);
      }
    } catch (e) {
      void load();
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(false);
    }
  }, [load]);

  const actOne = useCallback(
    (id: string, decision: "approve" | "reject") => {
      void bulkAct([id], decision);
    },
    [bulkAct],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(flatItems.map((i) => i.id)));
  };

  const approveHighConfidence = () => {
    const ids = flatItems.filter((i) => i.confidencePct >= 90).map((i) => i.id);
    void bulkAct(ids, "approve");
  };

  const rejectDuplicates = () => {
    const reject = new Set<string>();
    for (const cluster of filteredDuplicateClusters) {
      const sorted = [...cluster.itemIds].sort();
      for (let i = 1; i < sorted.length; i++) reject.add(sorted[i]!);
    }
    void bulkAct([...reject], "reject");
  };

  const bulkApproveBySource = (source: string) => {
    void bulkAct(
      flatItems.filter((i) => i.sourceType === source).map((i) => i.id),
      "approve",
    );
  };

  const bulkApproveByField = (field: string) => {
    void bulkAct(
      flatItems.filter((i) => i.fieldName === field).map((i) => i.id),
      "approve",
    );
  };

  const approveProvider = (provider: AdminProviderGroup) => {
    const ids = provider.sections.flatMap((s) => s.items.map((i) => i.id));
    void bulkAct(ids, "approve");
  };

  const approveCluster = (cluster: DuplicateCluster) => {
    void bulkAct(cluster.itemIds, "approve");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (flatItems.length === 0) return;

      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const next = focusIndex < flatItems.length - 1 ? focusIndex + 1 : 0;
        setFocusId(flatItems[next]!.id);
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        const prev = focusIndex > 0 ? focusIndex - 1 : flatItems.length - 1;
        setFocusId(flatItems[prev]!.id);
      }
      if (e.key === "a" || e.key === "A") {
        if (focusId) {
          e.preventDefault();
          actOne(focusId, "approve");
        }
      }
      if (e.key === "r" || e.key === "R") {
        if (focusId) {
          e.preventDefault();
          actOne(focusId, "reject");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flatItems, focusIndex, focusId, actOne]);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`review-item-${focusId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusId]);

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
    void load();
  };

  const metrics = review?.metrics;

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 pb-16 md:p-6">
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur border-b space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Provider crawler review</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Grouped by provider · diff vs approved · bulk moderation ·{" "}
            <kbd className="rounded border px-1 text-xs">A</kbd> approve ·{" "}
            <kbd className="rounded border px-1 text-xs">R</kbd> reject ·{" "}
            <kbd className="rounded border px-1 text-xs">J</kbd>/<kbd className="rounded border px-1 text-xs">K</kbd> navigate
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || bulkBusy}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {metrics ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Pending (DB)", value: metrics.pendingTotal },
            { label: "To review", value: metrics.reviewableCount },
            { label: "Avg confidence", value: `${metrics.avgConfidencePct}%` },
            { label: "Auto-approved", value: `${metrics.autoApprovedPct}%` },
            { label: "Duplicates", value: `${metrics.duplicatePct}%` },
            { label: "Approval rate", value: `${metrics.approvalRatePct}%` },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border bg-card px-3 py-2">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-lg font-semibold tabular-nums">{m.value}</p>
            </div>
          ))}
        </div>
      ) : null}
      {metrics?.newestExtraction ? (
        <p className="text-xs text-muted-foreground">
          Newest extraction: {new Date(metrics.newestExtraction).toLocaleString()}
          {metrics.hiddenIdenticalCount > 0
            ? ` · ${metrics.hiddenIdenticalCount} identical-to-approved hidden`
            : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={approveHighConfidence}>
          Approve all ≥90%
        </Button>
        <Button size="sm" variant="outline" disabled={bulkBusy} onClick={rejectDuplicates}>
          Reject duplicate extras
        </Button>
        <Button
          size="sm"
          disabled={bulkBusy || selected.size === 0}
          onClick={() => void bulkAct([...selected], "approve")}
        >
          Approve selected ({selected.size})
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={bulkBusy || selected.size === 0}
          onClick={() => void bulkAct([...selected], "reject")}
        >
          Reject selected
        </Button>
        <Button size="sm" variant="ghost" onClick={selectAllVisible}>
          Select visible
        </Button>
        {sourceFilter !== "all" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkBusy}
            onClick={() => bulkApproveBySource(sourceFilter)}
          >
            Approve all {sourceFilter}
          </Button>
        ) : null}
        {fieldType !== "all" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkBusy}
            onClick={() => bulkApproveByField(fieldType)}
          >
            Approve all {fieldLabel(fieldType)}
          </Button>
        ) : null}
        {selected.size > 0 && flatItems[0] ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const src = flatItems.find((i) => selected.has(i.id))?.sourceType;
                if (!src) return;
                const ids = flatItems.filter((i) => i.sourceType === src).map((i) => i.id);
                setSelected(new Set(ids));
              }}
            >
              Select same source
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const fn = flatItems.find((i) => selected.has(i.id))?.fieldName;
                if (!fn) return;
                const ids = flatItems.filter((i) => i.fieldName === fn).map((i) => i.id);
                setSelected(new Set(ids));
              }}
            >
              Select same field type
            </Button>
          </>
        ) : null}
      </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b pb-2">
        {PRIORITY_TABS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={activeTab === t.id ? "default" : "ghost"}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input
          placeholder="Search provider, field, value…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="lg:col-span-2"
        />
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value)}
        >
          <option value="all">All field types</option>
          {fieldTypes.map((f) => (
            <option key={f} value={f}>
              {fieldLabel(f)}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Input
          type="number"
          min={0}
          max={100}
          placeholder="Min confidence %"
          value={minConfidence || ""}
          onChange={(e) => setMinConfidence(Number(e.target.value) || 0)}
        />
        <Input
          placeholder="Practice area contains…"
          value={practiceArea}
          onChange={(e) => setPracticeArea(e.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={pendingAge}
          onChange={(e) => setPendingAge(e.target.value as PendingAgeFilter)}
        >
          <option value="all">Any pending age</option>
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      {activeTab === "duplicates" && filteredDuplicateClusters.length > 0 ? (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <p className="text-sm font-medium">
            Duplicate clusters ({filteredDuplicateClusters.length})
          </p>
          <p className="text-xs text-muted-foreground">
            Identical field values across providers — approve once for all, or reject extras.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredDuplicateClusters.map((c) => (
              <div key={c.id} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{fieldLabel(c.fieldName)}</span>
                  <Badge variant="secondary">{c.providerCount} providers</Badge>
                  <Badge variant="outline">{c.confidencePct}% avg</Badge>
                </div>
                {c.canonicalSlugs?.length ? (
                  <PracticeAreaCanonicalChips slugs={c.canonicalSlugs} />
                ) : (
                  <p className="text-sm line-clamp-3">{c.displayValue}</p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" disabled={bulkBusy} onClick={() => approveCluster(c)}>
                    Approve all ({c.itemIds.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkBusy}
                    onClick={() => {
                      const sorted = [...c.itemIds].sort();
                      void bulkAct(sorted.slice(1), "reject");
                    }}
                  >
                    Reject extras
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {review && filteredDuplicateClusters.length > 0 && activeTab !== "duplicates" ? (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <p className="text-sm font-medium">Cross-provider duplicates ({filteredDuplicateClusters.length})</p>
          <div className="flex flex-wrap gap-2">
            {filteredDuplicateClusters.slice(0, 6).map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs">
                <span className="max-w-[200px] truncate">{fieldLabel(c.fieldName)}: {c.displayValue}</span>
                <Badge variant="secondary">{c.providerCount} providers</Badge>
                <Button size="sm" className="h-7" disabled={bulkBusy} onClick={() => approveCluster(c)}>
                  Approve all
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {!loading && filteredProviders.length === 0 && activeTab !== "duplicates" ? (
        <p className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          No items match filters
          {pendingRaw.length > 0 ? ` (${pendingRaw.length} pending in DB)` : ""}.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div ref={listRef} className="space-y-3 min-w-0">
        {filteredProviders.map((provider) => (
          <Collapsible
            key={provider.entityId}
            open={expandedProviders.has(provider.entityId)}
            onOpenChange={(open) => {
              setExpandedProviders((prev) => {
                const next = new Set(prev);
                if (open) next.add(provider.entityId);
                else next.delete(provider.entityId);
                return next;
              });
            }}
          >
            <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
              <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
                <ChevronDown
                  className={`size-4 shrink-0 transition-transform ${expandedProviders.has(provider.entityId) ? "rotate-180" : ""}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{provider.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {provider.itemCount} change{provider.itemCount === 1 ? "" : "s"} · max{" "}
                    {provider.maxConfidencePct}% confidence
                  </p>
                </div>
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() => approveProvider(provider)}
                  >
                    Approve all
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={provider.searchUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-3.5 mr-1" />
                      Search
                    </Link>
                  </Button>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 space-y-4">
                  {provider.sections.map((section) => (
                    <Collapsible key={section.key} defaultOpen>
                      <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                        <ChevronDown className="size-3.5" />
                        {section.label}
                        <Badge variant="outline" className="ml-1">
                          {section.items.length}
                        </Badge>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-3 pl-5">
                        {section.items.map((item) => (
                          <ReviewItemRow
                            key={item.id}
                            item={item}
                            focused={focusId === item.id}
                            selected={selected.has(item.id)}
                            bulkBusy={bulkBusy}
                            onToggleSelect={() => toggleSelect(item.id)}
                            onApprove={() => actOne(item.id, "approve")}
                            onReject={() => actOne(item.id, "reject")}
                          />
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-36 rounded-lg border bg-card p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Focused item
          </p>
          {focusItem ? (
            <>
              <p className="font-semibold">{focusItem.providerLabel}</p>
              <p className="text-sm text-muted-foreground">{fieldLabel(focusItem.fieldName)}</p>
              <ReviewItemRow
                item={focusItem}
                focused
                selected={selected.has(focusItem.id)}
                bulkBusy={bulkBusy}
                onToggleSelect={() => toggleSelect(focusItem.id)}
                onApprove={() => actOne(focusItem.id, "approve")}
                onReject={() => actOne(focusItem.id, "reject")}
              />
              <Button variant="ghost" size="sm" className="w-full" asChild>
                <Link href={focusItem.searchUrl} target="_blank" rel="noopener noreferrer">
                  View in search
                  <ExternalLink className="size-3.5 ml-1" />
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {focusIndex + 1} / {flatItems.length}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Use J/K to focus an item</p>
          )}
        </div>
      </aside>
      </div>

      <Collapsible open={showDebug} onOpenChange={setShowDebug}>
        <CollapsibleTrigger className="text-xs text-muted-foreground hover:underline">
          {showDebug ? "Hide" : "Show"} queue & debug
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          <section className="rounded-lg border bg-muted/30 p-3 font-mono text-xs text-muted-foreground space-y-1">
            <p className="font-sans text-sm font-medium text-foreground">Freshness debug</p>
            <p>Raw pending rows: {pendingRaw.length}</p>
            <p>
              DB rows (total / pending_review):{" "}
              {meta ? `${meta.dbRowCount} / ${meta.pendingRowCount}` : "—"}
            </p>
            <p>Environment: {meta?.environment ?? "—"}</p>
            <p>DATABASE_URL host: {meta?.databaseHost ?? "—"}</p>
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
              <p className="text-xs text-muted-foreground">
                {jobs.length} job(s) queued — run npm run providers:crawl
              </p>
            ) : null}
          </section>
        </CollapsibleContent>
      </Collapsible>
    </main>
  );
}
