"use client";

import { Badge } from "@/components/ui/badge";
import type { AdminReviewItem, ConfidenceTier } from "@/lib/provider-crawler/admin-review";
import {
  normalizePracticeAreas,
  slugLabel,
  type NormalizedPracticeAreas,
} from "@/lib/provider-crawler/practice-area-normalizer";
import { ExternalLink } from "lucide-react";

export function confidenceClass(tier: ConfidenceTier): string {
  if (tier === "high") return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30";
  if (tier === "medium") return "bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/30";
  return "bg-red-500/15 text-red-800 dark:text-red-300 border-red-500/30";
}

export function fieldLabel(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function parseChips(value: string): string[] {
  return value
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function addedParts(current: string | null, proposed: string): string[] {
  const cur = new Set(parseChips(current ?? "").map((s) => s.toLowerCase()));
  return parseChips(proposed).filter((p) => !cur.has(p.toLowerCase()));
}

export function PracticeAreaCanonicalChips({
  slugs,
  highlightSlugs,
}: {
  slugs: string[];
  highlightSlugs?: Set<string>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {slugs.map((slug) => (
        <Badge
          key={slug}
          variant="secondary"
          className={
            highlightSlugs?.has(slug)
              ? "bg-primary/15 text-primary border-primary/30 font-mono text-xs"
              : "font-mono text-xs"
          }
          title={slugLabel(slug)}
        >
          {slugLabel(slug)}
        </Badge>
      ))}
    </div>
  );
}

export function PracticeAreaRawDetails({
  normalization,
}: {
  normalization: NormalizedPracticeAreas;
}) {
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:underline list-none">
        <span className="group-open:hidden">Raw extracted text</span>
        <span className="hidden group-open:inline">Hide raw extracted text</span>
      </summary>
      <div className="mt-2 rounded-md border bg-muted/20 p-2 space-y-2 text-xs">
        <p className="font-mono whitespace-pre-wrap break-words">{normalization.rawExtractedValue}</p>
        {normalization.provenance.length > 0 ? (
          <ul className="space-y-1 text-muted-foreground">
            {normalization.provenance.map((p) => (
              <li key={`${p.raw}-${p.slug ?? "x"}`}>
                <span className="text-foreground">{p.raw}</span>
                {" → "}
                {p.slug ? (
                  <span>
                    <span className="font-mono">{p.slug}</span> ({Math.round(p.confidence * 100)}%)
                  </span>
                ) : (
                  <span className="italic">unmapped</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-muted-foreground">
          Taxonomy confidence: {Math.round(normalization.taxonomyConfidence * 100)}%
        </p>
      </div>
    </details>
  );
}

export function ConfidenceBadge({ item }: { item: AdminReviewItem }) {
  return (
    <Badge variant="outline" className={confidenceClass(item.confidenceTier)}>
      {item.confidencePct}%
    </Badge>
  );
}

export function ProvenanceBadge({ item }: { item: AdminReviewItem }) {
  const label = item.sourceType.replace(/_/g, " ");
  return (
    <Badge variant="secondary" className="font-normal capitalize">
      {label}
      {item.extractionMethod ? ` · ${item.extractionMethod.replace(/_/g, " ")}` : ""}
    </Badge>
  );
}

export function ReviewItemRow({
  item,
  focused,
  selected,
  bulkBusy,
  onToggleSelect,
  onApprove,
  onReject,
}: {
  item: AdminReviewItem;
  focused: boolean;
  selected: boolean;
  bulkBusy: boolean;
  onToggleSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div
      id={`review-item-${item.id}`}
      className={`rounded-md border p-3 transition-colors ${
        focused ? "ring-2 ring-primary border-primary/40 bg-primary/[0.02]" : "bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start gap-2 mb-2">
        <input
          type="checkbox"
          className="mt-1 size-4 rounded border"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${item.fieldName}`}
        />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{fieldLabel(item.fieldName)}</span>
            <ConfidenceBadge item={item} />
            <ProvenanceBadge item={item} />
            {item.isDuplicate ? (
              <Badge variant="outline" className="text-amber-700 border-amber-500/40">
                duplicate
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Pending {formatPendingAge(item.extractedAt)}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={bulkBusy}
            onClick={onApprove}
          >
            Approve
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium disabled:opacity-50"
            disabled={bulkBusy}
            onClick={onReject}
          >
            Reject
          </button>
        </div>
      </div>
      <DiffPanel item={item} />
      {item.practiceAreaNormalization ? (
        <PracticeAreaRawDetails normalization={item.practiceAreaNormalization} />
      ) : null}
      <details className="mt-2 group">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:underline list-none">
          <span className="group-open:hidden">Show details</span>
          <span className="hidden group-open:inline">Hide details</span>
        </summary>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground font-mono">
          <p>ID: {item.id}</p>
          <p>Entity: {item.entityId}</p>
          <p>Extracted: {new Date(item.extractedAt).toLocaleString()}</p>
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              className="inline-flex items-center gap-1 text-primary hover:underline break-all font-sans"
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.sourceUrl}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : null}
          {item.provenanceNote ? <p>Note: {item.provenanceNote}</p> : null}
        </div>
      </details>
    </div>
  );
}

function formatPendingAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FieldValueDisplay({
  fieldName,
  value,
  highlightNew,
  current,
  practiceAreaNormalization,
}: {
  fieldName: string;
  value: string;
  highlightNew?: boolean;
  current?: string | null;
  practiceAreaNormalization?: NormalizedPracticeAreas;
}) {
  if (fieldName === "practice_areas" && practiceAreaNormalization) {
    const currentSlugs = current
      ? new Set(normalizePracticeAreas(current).canonicalSlugs)
      : new Set<string>();
    const highlight = new Set(
      practiceAreaNormalization.canonicalSlugs.filter((s) => !currentSlugs.has(s)),
    );
    return (
      <PracticeAreaCanonicalChips
        slugs={practiceAreaNormalization.canonicalSlugs}
        highlightSlugs={highlightNew ? highlight : undefined}
      />
    );
  }
  if (fieldName === "phone") {
    const tel = value.replace(/\s/g, "");
    return (
      <a href={`tel:${tel}`} className="text-sm font-medium text-primary hover:underline">
        {value}
      </a>
    );
  }
  if (fieldName === "email") {
    return (
      <a href={`mailto:${value}`} className="text-sm font-medium text-primary hover:underline break-all">
        {value}
      </a>
    );
  }
  if (
    fieldName === "website" ||
    fieldName === "contact_page" ||
    fieldName === "trustpilot_profile_url" ||
    value.startsWith("http")
  ) {
    const href = value.startsWith("http") ? value : `https://${value}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary hover:underline break-all"
      >
        {value}
      </a>
    );
  }
  if (
    fieldName === "practice_areas" ||
    fieldName === "capabilities" ||
    fieldName === "fundingCapabilities" ||
    fieldName === "languages"
  ) {
    const chips = parseChips(value);
    const added = highlightNew ? addedParts(current ?? null, value) : [];
    const addedSet = new Set(added.map((a) => a.toLowerCase()));
    return (
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <Badge
            key={chip}
            variant="secondary"
            className={
              addedSet.has(chip.toLowerCase())
                ? "bg-primary/15 text-primary border-primary/30"
                : undefined
            }
          >
            {chip}
          </Badge>
        ))}
      </div>
    );
  }
  return <p className="text-sm break-words whitespace-pre-wrap">{value}</p>;
}

export function DiffPanel({ item }: { item: AdminReviewItem }) {
  const hasCurrent = Boolean(item.currentValue?.trim());
  const isPracticeAreas = item.fieldName === "practice_areas";
  const isList =
    isPracticeAreas ||
    item.fieldName === "capabilities" ||
    item.fieldName === "fundingCapabilities";

  const proposedSlugs = item.practiceAreaNormalization?.canonicalSlugs ?? [];
  const currentSlugs = hasCurrent
    ? normalizePracticeAreas(item.currentValue!).canonicalSlugs
    : [];

  if (!hasCurrent && isPracticeAreas && proposedSlugs.length > 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Proposed (canonical)</p>
        <PracticeAreaCanonicalChips slugs={proposedSlugs} highlightSlugs={new Set(proposedSlugs)} />
      </div>
    );
  }

  if (!hasCurrent && !isList) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Proposed (new)</p>
        <FieldValueDisplay fieldName={item.fieldName} value={item.extractedValue} />
      </div>
    );
  }

  if (isPracticeAreas && (proposedSlugs.length > 0 || currentSlugs.length > 0)) {
    const added = new Set(proposedSlugs.filter((s) => !currentSlugs.includes(s)));
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Current</p>
          {currentSlugs.length > 0 ? (
            <PracticeAreaCanonicalChips slugs={currentSlugs} />
          ) : (
            <p className="text-sm text-muted-foreground italic">None approved</p>
          )}
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Proposed</p>
          <PracticeAreaCanonicalChips slugs={proposedSlugs} highlightSlugs={added} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Current</p>
        {hasCurrent ? (
          <FieldValueDisplay fieldName={item.fieldName} value={item.currentValue!} />
        ) : (
          <p className="text-sm text-muted-foreground italic">None approved</p>
        )}
      </div>
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Proposed</p>
        <FieldValueDisplay
          fieldName={item.fieldName}
          value={item.extractedValue}
          highlightNew={isList}
          current={item.currentValue}
          practiceAreaNormalization={item.practiceAreaNormalization}
        />
      </div>
    </div>
  );
}
