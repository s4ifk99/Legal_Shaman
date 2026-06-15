import { isRegulatoryOrDirectoryUrl } from "@/lib/provider-enrichment/regulatory-url-filter";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

export type V2WebsiteRow = {
  url: string;
  confidence: number;
  status: string;
};

export type WebsiteResolution = {
  approvedWebsite?: string;
  pendingWebsite?: string;
  skipReason?: string;
  websiteForExtraction?: string;
};

const APPROVED_STATUSES = new Set(["approved", "auto_approved"]);

function pickBestUrl(
  rows: { url: string; confidence: number }[],
): string | undefined {
  if (rows.length === 0) return undefined;
  const sorted = [...rows].sort((a, b) => b.confidence - a.confidence);
  return sorted[0]?.url;
}

function approvedWebsiteFromEnrichments(enrichments: ProviderEnrichment[]): string | undefined {
  const rows = enrichments.filter(
    (e) =>
      e.fieldName === "website" &&
      APPROVED_STATUSES.has(e.status) &&
      !isRegulatoryOrDirectoryUrl(e.extractedValue),
  );
  return pickBestUrl(rows.map((r) => ({ url: r.extractedValue, confidence: r.confidence })));
}

function websitesFromV2Rows(
  rows: V2WebsiteRow[],
  statuses: Set<string>,
): string | undefined {
  const eligible = rows.filter(
    (r) => statuses.has(r.status) && !isRegulatoryOrDirectoryUrl(r.url),
  );
  return pickBestUrl(eligible);
}

export function resolveWebsiteForPracticeExtraction(args: {
  enrichments: ProviderEnrichment[];
  v2Websites: V2WebsiteRow[];
  allowPendingWebsites?: boolean;
  pendingWebsiteMinConfidence?: number;
}): WebsiteResolution {
  const minPending = args.pendingWebsiteMinConfidence ?? 0.95;
  const approvedFromEnrichment = approvedWebsiteFromEnrichments(args.enrichments);
  const approvedFromV2 = websitesFromV2Rows(args.v2Websites, APPROVED_STATUSES);
  const approvedWebsite = approvedFromEnrichment ?? approvedFromV2;

  const pendingCandidates = args.v2Websites.filter(
    (r) =>
      (r.status === "pending_review" || r.status === "audit_review") &&
      r.confidence >= minPending &&
      !isRegulatoryOrDirectoryUrl(r.url),
  );
  const pendingWebsite = pickBestUrl(pendingCandidates);

  if (approvedWebsite) {
    return {
      approvedWebsite,
      pendingWebsite,
      websiteForExtraction: approvedWebsite,
    };
  }

  if (args.allowPendingWebsites && pendingWebsite) {
    return {
      pendingWebsite,
      websiteForExtraction: pendingWebsite,
    };
  }

  if (pendingWebsite) {
    return {
      pendingWebsite,
      skipReason: "no_approved_website",
    };
  }

  return { skipReason: "no_approved_website" };
}
