import { detectWeakReasons, priorityScoreForWeak } from "@/lib/provider-enrichment-ladder/weak-provider-detector";
import { planLadderSteps } from "@/lib/provider-enrichment-ladder/source-priority";
import type { EnrichmentPlan } from "@/lib/provider-enrichment-ladder/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

function missingFieldsList(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[],
): string[] {
  const reasons = detectWeakReasons(doc, enrichments);
  const fields: string[] = [];
  if (reasons.includes("no_phone")) fields.push("phone");
  if (reasons.includes("no_website")) fields.push("website");
  if (reasons.includes("no_approved_email")) fields.push("email");
  if (reasons.includes("no_practice_area_slugs")) fields.push("practiceAreaSlugs");
  if (reasons.includes("no_location_point")) fields.push("address");
  if (reasons.includes("no_capabilities")) fields.push("capabilities");
  return fields;
}

export function buildEnrichmentPlan(
  doc: LegalEntityDocument,
  enrichments: ProviderEnrichment[] = [],
): EnrichmentPlan | null {
  const reasons = detectWeakReasons(doc, enrichments);
  if (!reasons.length) return null;

  const websiteMatch = doc.website ?? doc.searchText?.match(/https?:\/\/[^\s,)]+/i)?.[0];

  return {
    entityId: doc.id,
    entityType: doc.entityType,
    title: doc.title,
    steps: planLadderSteps(doc),
    missingFields: missingFieldsList(doc, enrichments),
    priorityScore: priorityScoreForWeak(doc, reasons, enrichments),
    website: websiteMatch,
    profileUrl: doc.profileUrl,
  };
}

export function planWeakProviders(
  docs: LegalEntityDocument[],
  enrichmentByEntity: Map<string, ProviderEnrichment[]>,
  opts?: { limit?: number; sraOnly?: boolean },
): EnrichmentPlan[] {
  const plans: EnrichmentPlan[] = [];
  for (const doc of docs) {
    if (opts?.sraOnly && doc.entityType !== "sra_organisation") continue;
    const plan = buildEnrichmentPlan(doc, enrichmentByEntity.get(doc.id) ?? []);
    if (plan) plans.push(plan);
  }
  plans.sort((a, b) => b.priorityScore - a.priorityScore);
  return opts?.limit ? plans.slice(0, opts.limit) : plans;
}
