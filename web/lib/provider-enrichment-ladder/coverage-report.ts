import { analyzeWeakProviders } from "@/lib/provider-enrichment-ladder/weak-provider-detector";
import type {
  CoverageDataSources,
  CoverageHealth,
  CoverageLoadContext,
} from "@/lib/provider-enrichment-ladder/coverage-report-types";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import type { ProviderEnrichment } from "@/lib/provider-enrichment/types";
import type { WeakProviderReport } from "@/lib/provider-enrichment-ladder/types";

export type UnavailableWeakSummary = {
  unavailable: true;
  reason: string;
  totalScanned: null;
  totalWeak: null;
  weakBySource: Record<string, number>;
  weakByReason: WeakProviderReport["weakByReason"];
  weakByPracticeArea: Record<string, number>;
  topPriority: [];
};

export type CoverageMissingContact = {
  noPhone: number | null;
  noEmail: number | null;
  noWebsite: number | null;
  reason?: string;
};

export type ProviderCoverageLadderReport = {
  weak: WeakProviderReport | UnavailableWeakSummary;
  ladderStatusCounts: Record<string, number> | null;
  missingContact: CoverageMissingContact;
  missingPracticeArea: number | null;
  pendingReviewEnrichments: number | null;
  pendingReviewExtracted: number | null;
  yellMetrics: {
    yellContactCandidates: number;
    yellAutoApprovedContacts: number;
    yellPendingContacts: number;
    yellRejectedIdentityCandidates: number;
    yellTownsScanned: number;
  } | null;
  dataSources: CoverageDataSources;
  health: CoverageHealth;
  reportValid: boolean;
  degraded: boolean;
};

const EMPTY_WEAK_BY_REASON = (): WeakProviderReport["weakByReason"] => ({
  no_phone: 0,
  no_website: 0,
  no_approved_email: 0,
  no_practice_area_slugs: 0,
  no_taxonomy_aliases: 0,
  short_search_text: 0,
  no_capabilities: 0,
  no_location_point: 0,
  low_index_quality: 0,
});

function unavailableWeak(reason: string): UnavailableWeakSummary {
  return {
    unavailable: true,
    reason,
    totalScanned: null,
    totalWeak: null,
    weakBySource: {},
    weakByReason: EMPTY_WEAK_BY_REASON(),
    weakByPracticeArea: {},
    topPriority: [],
  };
}

function unavailableMissingContact(reason: string): CoverageMissingContact {
  return {
    noPhone: null,
    noEmail: null,
    noWebsite: null,
    reason,
  };
}

function computeMissingContact(
  sraDocs: LegalEntityDocument[],
  enrichmentByEntity: Map<string, ProviderEnrichment[]>,
  enrichmentsAvailable: boolean,
): CoverageMissingContact {
  let noPhone = 0;
  let noEmail = 0;
  let noWebsite = 0;

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
  }

  if (!enrichmentsAvailable) {
    return {
      noPhone,
      noEmail,
      noWebsite,
      reason: "providerEnrichment unavailable (counts use index fields only)",
    };
  }

  return { noPhone, noEmail, noWebsite };
}

async function loadPendingReviewCounts(enrichmentsAvailable: boolean): Promise<{
  pendingReviewEnrichments: number | null;
  pendingReviewExtracted: number | null;
  ladderStatusCounts: Record<string, number> | null;
}> {
  if (!enrichmentsAvailable) {
    return {
      pendingReviewEnrichments: null,
      pendingReviewExtracted: null,
      ladderStatusCounts: null,
    };
  }

  try {
    const { prisma } = await import("@/lib/db/prisma");
    const { countByLadderStatus } = await import(
      "@/lib/provider-enrichment-ladder/enrichment-state-store"
    );
    const [pendingReviewEnrichments, pendingReviewExtracted, ladderStatusCounts] =
      await Promise.all([
        prisma.providerEnrichment
          .count({ where: { status: "pending_review" } })
          .catch(() => null),
        prisma.providerExtractedField
          .count({ where: { status: "pending_review" } })
          .catch(() => null),
        countByLadderStatus(),
      ]);

    return { pendingReviewEnrichments, pendingReviewExtracted, ladderStatusCounts };
  } catch (e) {
    const { warnCoverageDatasourceUnavailable } = await import(
      "@/lib/provider-enrichment-ladder/coverage-report-log"
    );
    warnCoverageDatasourceUnavailable("providerEnrichment.pendingCounts", e);
    return {
      pendingReviewEnrichments: null,
      pendingReviewExtracted: null,
      ladderStatusCounts: null,
    };
  }
}

export async function buildCoverageLadderReport(
  docs: LegalEntityDocument[],
  enrichmentByEntity: Map<string, ProviderEnrichment[]>,
  load: CoverageLoadContext,
): Promise<ProviderCoverageLadderReport> {
  const { dataSources, health, sraAvailable, enrichmentsAvailable } = load;
  const degraded =
    !sraAvailable ||
    !enrichmentsAvailable ||
    health.loadedSraRows === 0 ||
    health.loadedSraRows < 1000;

  if (!sraAvailable) {
    const reason = dataSources.sraOrganisations.error
      ? `sraOrganisation unavailable: ${dataSources.sraOrganisations.error}`
      : "sraOrganisation unavailable";
    return {
      weak: unavailableWeak(reason),
      ladderStatusCounts: null,
      missingContact: unavailableMissingContact("sraOrganisation unavailable"),
      missingPracticeArea: null,
      pendingReviewEnrichments: null,
      pendingReviewExtracted: null,
      yellMetrics: null,
      dataSources,
      health,
      reportValid: false,
      degraded: true,
    };
  }

  const sraDocs = docs.filter((d) => d.entityType === "sra_organisation");
  const weak = analyzeWeakProviders(sraDocs, enrichmentByEntity, {
    sraOnly: true,
    topN: 30,
  });

  let missingPracticeArea = 0;
  for (const d of sraDocs) {
    if ((d.practiceAreaSlugs?.length ?? 0) === 0) missingPracticeArea++;
  }

  const pending = await loadPendingReviewCounts(enrichmentsAvailable);

  const { loadYellCoverageMetrics } = await import("@/lib/provider-enrichment/yell-metrics");
  const yellMetrics = enrichmentsAvailable ? await loadYellCoverageMetrics() : null;

  const reportValid = health.loadedSraRows > 0;

  return {
    weak,
    ladderStatusCounts: pending.ladderStatusCounts,
    missingContact: computeMissingContact(sraDocs, enrichmentByEntity, enrichmentsAvailable),
    missingPracticeArea,
    pendingReviewEnrichments: pending.pendingReviewEnrichments,
    pendingReviewExtracted: pending.pendingReviewExtracted,
    yellMetrics: yellMetrics ?? null,
    dataSources,
    health,
    reportValid,
    degraded,
  };
}

export async function buildFullCoverageReport(opts?: {
  take?: number;
}): Promise<ProviderCoverageLadderReport> {
  const { loadCoverageReportInputs } = await import(
    "@/lib/provider-enrichment-ladder/coverage-report-datasources"
  );
  const inputs = await loadCoverageReportInputs(opts);
  return buildCoverageLadderReport(inputs.docs, inputs.enrichmentByEntity, inputs);
}
