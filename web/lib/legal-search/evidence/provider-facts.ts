import type { TriageSectionKind } from "@/lib/legal-search/triage/types";
import { isAcceptablePublishedPrice } from "@/lib/legal-search/evidence/published-price-validate";
import type {
  ApprovedReviewSignal,
  EvidenceFact,
  EvidenceSourceCite,
  ProviderEvidence,
  PublishedPriceRecord,
} from "@/lib/legal-search/evidence/types";

const APPROVED = new Set(["approved", "auto_approved"]);

export type ProviderFactInput = {
  resultId: string;
  sectionKind: TriageSectionKind;
  reviewSignals?: ApprovedReviewSignal[];
  publishedPrice?: PublishedPriceRecord | null;
  /**
   * Seeded lawyer rows carry a rating. It is not a verified review and is never shown.
   */
  seedRating?: number | null;
};

function formatGbp(pence: number): string {
  const pounds = pence / 100;
  const whole = Number.isInteger(pounds);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(pounds);
}

function formatStars(stars: number): string {
  return Number.isInteger(stars) ? String(stars) : stars.toFixed(1);
}

function unpublishedCost(): EvidenceFact {
  return {
    label: "Price not published.",
    confidence: "low",
    costBand: "unpublished",
    costMinPence: null,
    costMaxPence: null,
  };
}

function noVerifiedReviews(): EvidenceFact {
  return {
    label: "No verified reviews.",
    confidence: "low",
    reviewStars: null,
    reviewCount: null,
  };
}

type ReviewSourceKey = "google" | "trustpilot" | "site";

function reviewSourceKey(signal: ApprovedReviewSignal): ReviewSourceKey | null {
  const type = signal.signalType;
  const source = (signal.sourceType ?? "").toLowerCase();
  if (type.startsWith("site:") || (source === "provider_website" && type.startsWith("site:"))) {
    return "site";
  }
  if (type.startsWith("google_places:") || source === "google_places") return "google";
  if (
    type.startsWith("trustpilot:") ||
    source.includes("trustpilot") ||
    type === "review_aggregate_rating" ||
    type === "review_count"
  ) {
    return "trustpilot";
  }
  return null;
}

function isRatingSignal(signalType: string): boolean {
  return (
    signalType === "review_aggregate_rating" ||
    signalType.endsWith(":review_aggregate_rating")
  );
}

function isCountSignal(signalType: string): boolean {
  return signalType === "review_count" || signalType.endsWith(":review_count");
}

type ParsedSourceReview = {
  key: ReviewSourceKey;
  stars: number;
  count: number;
  sourceUrl: string;
  sourceName: string;
};

function parseSourceReviews(signals: ApprovedReviewSignal[]): ParsedSourceReview[] {
  const approved = signals.filter(
    (signal) => APPROVED.has(signal.status) && Boolean(signal.sourceUrl?.trim()),
  );
  const byKey = new Map<
    ReviewSourceKey,
    {
      rating?: ApprovedReviewSignal;
      count?: ApprovedReviewSignal;
      publisher?: ApprovedReviewSignal;
    }
  >();
  for (const signal of approved) {
    const key = reviewSourceKey(signal);
    if (!key) continue;
    const bucket = byKey.get(key) ?? {};
    if (isRatingSignal(signal.signalType)) bucket.rating = signal;
    if (isCountSignal(signal.signalType)) bucket.count = signal;
    if (signal.signalType === "site:review_publisher" || signal.signalType.endsWith(":review_publisher")) {
      bucket.publisher = signal;
    }
    byKey.set(key, bucket);
  }

  const out: ParsedSourceReview[] = [];
  const order: ReviewSourceKey[] = ["google", "trustpilot", "site"];
  for (const key of order) {
    const bucket = byKey.get(key);
    if (!bucket?.rating?.sourceUrl || !bucket.count?.sourceUrl) continue;
    const stars = Number(bucket.rating.value);
    const count = Number(bucket.count.value);
    if (
      !Number.isFinite(stars) ||
      stars <= 0 ||
      stars > 5 ||
      !Number.isFinite(count) ||
      count <= 0
    ) {
      continue;
    }
    const publisherLabel = bucket.publisher?.value?.trim();
    const sourceName =
      key === "google"
        ? "Google Maps"
        : key === "trustpilot"
          ? "Trustpilot"
          : publisherLabel || "Firm website";
    out.push({
      key,
      stars,
      count: Math.round(count),
      sourceUrl: bucket.rating.sourceUrl,
      sourceName,
    });
  }
  return out;
}

function reviewFromSignals(signals: ApprovedReviewSignal[]): EvidenceFact {
  const sources = parseSourceReviews(signals);
  if (!sources.length) return noVerifiedReviews();

  const parts = sources.map(
    (source) =>
      `${source.sourceName}: ${formatStars(source.stars)} from ${source.count} review${
        source.count === 1 ? "" : "s"
      }`,
  );
  const cites: EvidenceSourceCite[] = sources.map((source) => ({
    name: source.sourceName,
    url: source.sourceUrl,
  }));
  // Filters use the best verified star rating across cited sources (never a blended average).
  const best = sources.reduce((a, b) => (b.stars > a.stars ? b : a));
  return {
    label: `${parts.join(" · ")}.`,
    confidence: "high",
    sourceName: cites.length === 1 ? cites[0]!.name : "Cited review sources",
    sourceUrl: cites[0]!.url,
    sources: cites,
    reviewStars: best.stars,
    reviewCount: best.count,
  };
}

function costFromRoute(sectionKind: TriageSectionKind): EvidenceFact {
  if (sectionKind === "pro_bono") {
    return {
      label: "No fee to you. This organisation is listed as a free or pro bono service.",
      confidence: "high",
      sourceName: "Legal Shaman free and pro bono listings",
      costBand: "free",
      costMinPence: 0,
      costMaxPence: 0,
    };
  }
  if (sectionKind === "legal_aid") {
    return {
      label:
        "Legal aid provider. Whether you pay anything depends on your income, capital, and the case. This is not a quote of this provider’s fee.",
      confidence: "high",
      sourceName: "GOV.UK legal aid",
      sourceUrl: "https://www.gov.uk/legal-aid",
      costBand: "legal_aid",
      costMinPence: null,
      costMaxPence: null,
    };
  }
  return unpublishedCost();
}

function costFromPublishedPrice(record: PublishedPriceRecord): EvidenceFact {
  const min = formatGbp(record.minPence);
  const max = formatGbp(record.maxPence);
  const amount = record.minPence === record.maxPence ? min : `${min}–${max}`;
  return {
    label: `Published price for ${record.service.trim()}: ${amount}. Checked ${record.checkedOn}.`,
    confidence: "high",
    sourceName: record.providerName.trim(),
    sourceUrl: record.sourceUrl,
    costBand: "published_fee",
    costMinPence: record.minPence,
    costMaxPence: record.maxPence,
  };
}

/**
 * Review and cost facts for one provider.
 * A stored star rating, including seeded lawyer ratings, is ignored.
 * A pound figure is shown only for an acceptable published-price record, and only on a private listing.
 */
export function buildProviderEvidence(input: ProviderFactInput): ProviderEvidence {
  void input.seedRating;
  const published =
    input.sectionKind === "private" && isAcceptablePublishedPrice(input.publishedPrice)
      ? input.publishedPrice
      : null;
  return {
    review: reviewFromSignals(input.reviewSignals ?? []),
    cost: published ? costFromPublishedPrice(published) : costFromRoute(input.sectionKind),
  };
}
