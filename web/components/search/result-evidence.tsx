"use client";

import type {
  DisputeTimescale,
  EvidenceFact,
  ProviderEvidence,
  ResultEvidenceFilters,
  SystemConfidence,
} from "@/lib/legal-search/evidence/types";
import { systemConfidenceLabel } from "@/lib/legal-search/evidence/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/locale-provider";

function ConfidenceLabel({ confidence }: { confidence: SystemConfidence }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        confidence === "high"
          ? "bg-emerald-100 text-emerald-950"
          : "bg-amber-100 text-amber-950",
      )}
    >
      {systemConfidenceLabel(confidence)}
    </span>
  );
}

function FactLine({ prefix, fact }: { prefix: string; fact: EvidenceFact }) {
  const cites =
    fact.confidence === "high" && fact.sources?.length
      ? fact.sources
      : fact.confidence === "high" && fact.sourceUrl
        ? [{ name: fact.sourceName ?? "Source", url: fact.sourceUrl }]
        : [];
  return (
    <p className="mt-1 text-sm leading-relaxed text-foreground/90">
      <span className="font-medium">{prefix}: </span>
      {fact.label} <ConfidenceLabel confidence={fact.confidence} />
      {cites.length > 0 ? (
        <>
          {" "}
          {cites.map((cite, index) => (
            <span key={`${cite.url}-${cite.name}`}>
              {index > 0 ? " · " : null}
              <a
                href={cite.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
                onClick={(event) => event.stopPropagation()}
              >
                {cite.name}
              </a>
            </span>
          ))}
        </>
      ) : null}
      {fact.confidence === "high" && cites.length === 0 && fact.sourceName ? (
        <span className="text-muted-foreground"> ({fact.sourceName})</span>
      ) : null}
    </p>
  );
}

export function ResultEvidenceLines({ evidence }: { evidence?: ProviderEvidence }) {
  const review = evidence?.review ?? {
    label: "No verified reviews.",
    confidence: "low" as const,
  };
  const cost = evidence?.cost ?? {
    label: "Price not published.",
    confidence: "low" as const,
    costBand: "unpublished" as const,
  };
  return (
    <div className="mt-2">
      <FactLine prefix="Reviews" fact={review} />
      <FactLine prefix="Cost" fact={cost} />
    </div>
  );
}

export function DisputeTimescaleBanner({ timescale }: { timescale: DisputeTimescale }) {
  return (
    <div className="rounded-md border bg-card p-4 text-sm leading-relaxed">
      <p className="font-medium text-foreground">{timescale.label}</p>
      <p className="mt-1 text-foreground/90">
        <span className="font-medium">{timescale.matterLabel}. </span>
        {timescale.rangeText} <ConfidenceLabel confidence={timescale.confidence} />
        {timescale.confidence === "high" && timescale.sourceUrl ? (
          <>
            {" "}
            <a
              href={timescale.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              {timescale.sourceName ?? "Source"}
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function ResultEvidenceFilterBar({
  value,
  onChange,
  shown,
  total,
  hiddenUnknown,
}: {
  value: ResultEvidenceFilters;
  onChange: (next: ResultEvidenceFilters) => void;
  shown: number;
  total: number;
  hiddenUnknown: number;
}) {
  const { t, fill } = useLocale();
  const reviewOptions: { id: ResultEvidenceFilters["reviews"]; label: string }[] = [
    { id: "all", label: t.all },
    { id: "verified", label: t.verifiedReviews },
    { id: "four_plus", label: t.fourStars },
  ];
  const costOptions: { id: ResultEvidenceFilters["cost"]; label: string }[] = [
    { id: "all", label: t.all },
    { id: "free", label: t.freeToYou },
    { id: "legal_aid", label: t.legalAid },
    { id: "published_fee", label: t.publishedPrice },
    { id: "unpublished", label: t.priceUnknown },
  ];
  const filtersActive = value.reviews !== "all" || value.cost !== "all";
  const hiddenNote = hiddenUnknown > 0 ? ` ${fill(t.filterHidden, { count: hiddenUnknown })}` : "";
  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">{t.reviews}</legend>
        <div className="flex flex-wrap gap-2">
          {reviewOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={value.reviews === option.id}
              onClick={() => onChange({ ...value, reviews: option.id })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                value.reviews === option.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">{t.cost}</legend>
        <div className="flex flex-wrap gap-2">
          {costOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={value.cost === option.id}
              onClick={() => onChange({ ...value, cost: option.id })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                value.cost === option.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      {filtersActive ? (
        <p className="text-sm text-muted-foreground">
          {shown === 0 ? `${t.filterNone}${hiddenNote}` : `${fill(t.showingProviders, { shown, total })}${hiddenNote}`}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{fill(t.filterShowingAll, { total })}</p>
      )}
    </div>
  );
}
