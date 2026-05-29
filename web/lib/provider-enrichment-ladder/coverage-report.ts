import { prisma } from "@/lib/db/prisma";
import { analyzeWeakProviders } from "@/lib/provider-enrichment-ladder/weak-provider-detector";
import { countByLadderStatus } from "@/lib/provider-enrichment-ladder/enrichment-state-store";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";

export type ProviderCoverageLadderReport = {
  weak: ReturnType<typeof analyzeWeakProviders>;
  ladderStatusCounts: Record<string, number>;
  missingContact: { noPhone: number; noEmail: number; noWebsite: number };
  missingPracticeArea: number;
  pendingReviewEnrichments: number;
  pendingReviewExtracted: number;
};

export async function buildCoverageLadderReport(
  docs: LegalEntityDocument[],
  enrichmentByEntity: Map<string, ProviderEnrichment[]>,
): Promise<ProviderCoverageLadderReport> {
  const sraDocs = docs.filter((d) => d.entityType === "sra_organisation");
  const weak = analyzeWeakProviders(sraDocs, enrichmentByEntity, {
    sraOnly: true,
    topN: 30,
  });

  let noPhone = 0;
  let noEmail = 0;
  let noWebsite = 0;
  let missingPracticeArea = 0;

  for (const d of sraDocs) {
    const e = enrichmentByEntity.get(d.id) ?? [];
    const approvedPhone =
      Boolean(d.phone) || e.some((x) => x.fieldName === "phone" && x.status !== "rejected");
    const approvedEmail =
      Boolean(d.email) || e.some((x) => x.fieldName === "email" && x.status !== "rejected");
    const hasWebsite =
      Boolean(d.website) || /https?:\/\//i.test(d.searchText ?? "");
    if (!approvedPhone) noPhone++;
    if (!approvedEmail) noEmail++;
    if (!hasWebsite) noWebsite++;
    if ((d.practiceAreaSlugs?.length ?? 0) === 0) missingPracticeArea++;
  }

  const [pendingReviewEnrichments, pendingReviewExtracted, ladderStatusCounts] =
    await Promise.all([
      prisma.providerEnrichment.count({ where: { status: "pending_review" } }).catch(() => 0),
      prisma.providerExtractedField.count({ where: { status: "pending_review" } }).catch(() => 0),
      countByLadderStatus(),
    ]);

  return {
    weak,
    ladderStatusCounts,
    missingContact: { noPhone, noEmail, noWebsite },
    missingPracticeArea,
    pendingReviewEnrichments,
    pendingReviewExtracted,
  };
}
