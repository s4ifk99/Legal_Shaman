export type ProviderCost = "free" | "publicly_funded" | "paid" | "unknown";

export type ProviderPositioning =
  | "charity"
  | "helpline"
  | "law_centre"
  | "legal_aid"
  | "sra_firm"
  | "directory"
  | "official"
  | "other";

export type WorkspaceSource = {
  id: string;
  type: string;
  title: string;
  blurb: string;
  url?: string;
  phone?: string;
  sraId?: string;
  coverage?: string;
  city?: string;
  sourceLabel: string;
  coversPlace?: boolean;
  unavailableReason?: string;
};

export type WorkspaceProvider = {
  key: string;
  name: string;
  blurb: string;
  url?: string;
  phone?: string;
  cost: ProviderCost;
  costLabel: string;
  reviewsLabel: string;
  googleReviewsUrl: string;
  feeLabel: string;
  feeSourceName: string;
  feeSourceUrl: string;
  locationLabel: string;
  locationKnown: boolean;
  positioning: ProviderPositioning;
  positioningLabel: string;
  sourceLabel: string;
  coversPlace: boolean;
  unavailableReason?: string;
  bookmark?: { entityId: string; resultSource: "sra" };
  sraId?: string;
};

const COST_RANK: Record<ProviderCost, number> = {
  publicly_funded: 0,
  free: 1,
  unknown: 2,
  paid: 3,
};

const COST_LABEL: Record<ProviderCost, string> = {
  free: "Free",
  publicly_funded: "Publicly funded",
  paid: "Paid",
  unknown: "Cost not stated",
};

const POSITION_LABEL: Record<ProviderPositioning, string> = {
  charity: "Charity",
  helpline: "Helpline",
  law_centre: "Law centre",
  legal_aid: "Legal aid",
  sra_firm: "SRA firm",
  directory: "Directory",
  official: "Official guidance",
  other: "Other",
};

export const NO_REVIEW_DATA = "No Google review data";
export const LOCATION_NOT_STATED = "Location not stated";

const LEGAL_AID_FEES = {
  label: "No private fee if you qualify for legal aid",
  sourceName: "GOV.UK",
  sourceUrl: "https://www.gov.uk/legal-aid",
};

const FREE_FEES = {
  label: "No private fee — free to contact",
  sourceName: "GOV.UK",
  sourceUrl: "https://www.gov.uk/legal-aid",
};

const PRIVATE_FEES = {
  label:
    "Open-source note: many firms offer a free first half hour or a fixed fee. This firm has not published a price in the sources we have.",
  sourceName: "Citizens Advice",
  sourceUrl:
    "https://www.citizensadvice.org.uk/law-and-courts/legal-system/finding-free-or-affordable-legal-help/",
};

const UNKNOWN_FEES = {
  label: "No fee published in the sources we have",
  sourceName: "Citizens Advice",
  sourceUrl:
    "https://www.citizensadvice.org.uk/law-and-courts/legal-system/finding-free-or-affordable-legal-help/",
};

function feeOf(cost: ProviderCost, blurb: string) {
  const mentioned = blurb.match(/£\s?\d[\d,]*(?:\s*(?:-|–|to)\s*£?\s?\d[\d,]*)?/);
  if (mentioned) {
    return {
      label: `Figure in the open source: ${mentioned[0]}`,
      sourceName: "Cited page",
      sourceUrl: PRIVATE_FEES.sourceUrl,
    };
  }
  if (cost === "publicly_funded") return LEGAL_AID_FEES;
  if (cost === "free") return FREE_FEES;
  if (cost === "paid") return PRIVATE_FEES;
  return UNKNOWN_FEES;
}

function googleReviewsUrl(name: string, city?: string): string {
  const query = [name, "reviews", city].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function costOf(type: string): ProviderCost {
  const t = type.toLowerCase();
  if (/legal aid|publicly funded|law centre|law center/.test(t)) return "publicly_funded";
  if (/third eye · directory|\bpaid\b|sra-regulated|solicitor/.test(t)) return "paid";
  if (/free|charity|helpline|official|pro bono|signpost|third eye/.test(t)) return "free";
  if (/\bdirectory\b/.test(t)) return "paid";
  return "unknown";
}

function positioningOf(source: WorkspaceSource): ProviderPositioning {
  const t = `${source.type} ${source.title}`.toLowerCase();
  if (source.sraId || /sra-regulated|solicitor/.test(t)) return "sra_firm";
  if (/law centre|law center/.test(t)) return "law_centre";
  if (/legal aid/.test(t)) return "legal_aid";
  if (/helpline/.test(t)) return "helpline";
  if (/directory/.test(t)) return "directory";
  if (/official|guidance|gov\.uk/.test(t)) return "official";
  if (/charity|free/.test(t)) return "charity";
  return "other";
}

function providerKey(source: WorkspaceSource): string {
  if (source.sraId) return `sra:${source.sraId}`;
  const url = (source.url || "").trim();
  if (/^https:\/\//i.test(url)) return url.replace(/\/+$/, "").toLowerCase();
  return `row:${source.id}`;
}

function locationOf(source: WorkspaceSource): { label: string; known: boolean } {
  const city = source.city?.trim();
  if (city) return { label: city, known: true };
  const coverage = source.coverage?.trim();
  if (coverage) return { label: coverage, known: true };
  return { label: LOCATION_NOT_STATED, known: false };
}

export function toWorkspaceProviders(sources: WorkspaceSource[]): WorkspaceProvider[] {
  const seen = new Set<string>();
  const out: WorkspaceProvider[] = [];
  for (const source of sources) {
    const name = source.title.trim();
    if (!name) continue;
    const key = providerKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    const cost = costOf(source.type);
    const positioning = positioningOf(source);
    const location = locationOf(source);
    const fee = feeOf(cost, source.blurb);
    out.push({
      key,
      name,
      blurb: source.blurb.trim(),
      url: source.url,
      phone: source.phone,
      cost,
      costLabel: COST_LABEL[cost],
      reviewsLabel: NO_REVIEW_DATA,
      googleReviewsUrl: googleReviewsUrl(name, source.city),
      feeLabel: fee.label,
      feeSourceName: fee.sourceName,
      feeSourceUrl: fee.sourceUrl,
      locationLabel: location.label,
      locationKnown: location.known,
      positioning,
      positioningLabel: POSITION_LABEL[positioning],
      sourceLabel: source.sourceLabel,
      coversPlace: source.coversPlace !== false,
      unavailableReason: source.unavailableReason,
      bookmark: source.sraId ? { entityId: source.sraId, resultSource: "sra" } : undefined,
      sraId: source.sraId,
    });
  }

  return out
    .map((provider, index) => ({ provider, index }))
    .sort(
      (a, b) =>
        COST_RANK[a.provider.cost] - COST_RANK[b.provider.cost] || a.index - b.index,
    )
    .map((row) => row.provider);
}

export function sortWorkspaceProviders(
  providers: WorkspaceProvider[],
  sort: "recommended" | "name",
): WorkspaceProvider[] {
  if (sort === "name") {
    return [...providers].sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  }
  return providers;
}
