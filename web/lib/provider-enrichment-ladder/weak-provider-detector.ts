import { computeIndexQualityScore } from "@/lib/search-index/index-quality-score";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import { computeProviderCompletenessScore } from "@/lib/provider-enrichment-ladder/provider-completeness-score";
import type {
  WeakProviderRecord,
  WeakProviderReport,
  WeakReason,
} from "@/lib/provider-enrichment-ladder/types";

export const SEARCH_TEXT_MIN_LENGTH = 80;
export const INDEX_QUALITY_WEAK_THRESHOLD = 0.42;

function hasApprovedContact(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
): { phone: boolean; email: boolean } {
  const approved = enrichments.filter(
    (e) => e.status === "approved" || e.status === "auto_approved",
  );
  const phone =
    Boolean(doc.phone?.trim()) ||
    approved.some((e) => e.fieldName === "phone");
  const email =
    Boolean(doc.email?.trim()) ||
    approved.some((e) => e.fieldName === "email");
  return { phone, email };
}

export function detectWeakReasons(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[] = [],
): WeakReason[] {
  const reasons: WeakReason[] = [];
  const contact = hasApprovedContact(doc, enrichments);

  if (!contact.phone) reasons.push("no_phone");
  if (!doc.website?.trim() && !/https?:\/\/[^\s,)]+/i.test(doc.searchText ?? "")) {
    reasons.push("no_website");
  }
  if (!contact.email) reasons.push("no_approved_email");
  if ((doc.practiceAreaSlugs?.length ?? 0) === 0) reasons.push("no_practice_area_slugs");
  if ((doc.taxonomyAliases?.length ?? 0) === 0) reasons.push("no_taxonomy_aliases");
  if ((doc.searchText?.length ?? 0) < SEARCH_TEXT_MIN_LENGTH) reasons.push("short_search_text");

  const capCount =
    (doc.capabilities?.length ?? 0) +
    (doc.fundingCapabilities?.length ?? 0) +
    (doc.urgencyCapabilities?.length ?? 0);
  if (capCount === 0) reasons.push("no_capabilities");
  if (!doc.locationPoint && !doc.postcode?.trim()) reasons.push("no_location_point");

  const indexQ = doc.indexQualityScore ?? computeIndexQualityScore(doc);
  if (indexQ < INDEX_QUALITY_WEAK_THRESHOLD) reasons.push("low_index_quality");

  return reasons;
}

export function isWeakProvider(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[] = [],
): boolean {
  return detectWeakReasons(doc, enrichments).length > 0;
}

export function priorityScoreForWeak(
  doc: LegalEntityDocument,
  reasons: WeakReason[],
  enrichments: ProviderEnrichment[] = [],
): number {
  const completeness = computeProviderCompletenessScore(doc, enrichments);
  const reasonWeight = reasons.length * 0.08;
  const sraBoost = doc.entityType === "sra_organisation" ? 0.15 : 0;
  const contactGap =
    (reasons.includes("no_phone") ? 0.12 : 0) +
    (reasons.includes("no_website") ? 0.1 : 0) +
    (reasons.includes("no_practice_area_slugs") ? 0.14 : 0);
  return Math.min(
    1,
    Math.round((1 - completeness + reasonWeight + sraBoost + contactGap) * 100) / 100,
  );
}

export function analyzeWeakProviders(
  docs: LegalEntityDocument[],
  enrichmentByEntity: Map<string, ProviderEnrichment[]> = new Map(),
  opts?: { sraOnly?: boolean; topN?: number },
): WeakProviderReport {
  const weakBySource: Record<string, number> = {};
  const weakByReason: Record<WeakReason, number> = {
    no_phone: 0,
    no_website: 0,
    no_approved_email: 0,
    no_practice_area_slugs: 0,
    no_taxonomy_aliases: 0,
    short_search_text: 0,
    no_capabilities: 0,
    no_location_point: 0,
    low_index_quality: 0,
  };
  const weakByPracticeArea: Record<string, number> = {};
  const weakRecords: WeakProviderRecord[] = [];

  for (const doc of docs) {
    if (opts?.sraOnly && doc.entityType !== "sra_organisation") continue;
    const enrichments = enrichmentByEntity.get(doc.id) ?? [];
    const reasons = detectWeakReasons(doc, enrichments);
    if (!reasons.length) continue;

    weakBySource[doc.source] = (weakBySource[doc.source] ?? 0) + 1;
    for (const r of reasons) weakByReason[r]++;

    const slugs = doc.practiceAreaSlugs ?? [];
    if (slugs.length) {
      for (const s of slugs) {
        weakByPracticeArea[s] = (weakByPracticeArea[s] ?? 0) + 1;
      }
    } else {
      weakByPracticeArea["(none)"] = (weakByPracticeArea["(none)"] ?? 0) + 1;
    }

    weakRecords.push({
      doc,
      reasons,
      priorityScore: priorityScoreForWeak(doc, reasons, enrichments),
      approvedEnrichments: enrichments.filter(
        (e) => e.status === "approved" || e.status === "auto_approved",
      ),
    });
  }

  weakRecords.sort((a, b) => b.priorityScore - a.priorityScore);
  const topN = opts?.topN ?? 25;

  return {
    totalWeak: weakRecords.length,
    totalScanned: opts?.sraOnly
      ? docs.filter((d) => d.entityType === "sra_organisation").length
      : docs.length,
    weakBySource,
    weakByReason,
    weakByPracticeArea,
    topPriority: weakRecords.slice(0, topN),
  };
}
