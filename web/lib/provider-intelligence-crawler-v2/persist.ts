import { prisma } from "@/lib/db/prisma";
import {
  loadApprovedRefsForEntity,
  loadOfficialWebsiteForEntity,
} from "@/lib/provider-enrichment/submit-with-policy";
import { validateEnrichmentCandidate } from "@/lib/provider-enrichment/validators";
import type { EnrichmentCandidate, EnrichmentStatus } from "@/lib/provider-enrichment/types";
import { resolveV2Approval, type V2ApprovalResult } from "@/lib/provider-intelligence-crawler-v2/auto-approve";
import type { ConfidenceSignals } from "@/lib/provider-intelligence-crawler-v2/confidence";
import type { V2ExtractionCandidate, V2RecordStatus } from "@/lib/provider-intelligence-crawler-v2/types";
import {
  isGloballyApproved,
} from "@/lib/provider-enrichment/global-value-approvals";
import {
  REGULATORY_REJECT_REASON,
  shouldBlockRegulatoryEnrichment,
} from "@/lib/provider-enrichment/regulatory-url-filter";
import { candidateMayEnterModeration } from "@/lib/provider-osint/website-candidate-types";
import {
  isObviouslySyntheticGeneratedUrl,
  isSyntheticWebsiteUrl,
  SYNTHETIC_REJECT_REASON,
} from "@/lib/provider-osint/synthetic-domain";
import {
  gatePracticeAreaLabelOrSlug,
  PRACTICE_AREA_TAXONOMY_REJECT_REASON,
} from "@/lib/provider-intelligence-crawler-v2/practice-area-taxonomy-gate";
import { buildSingleSraDocument } from "@/lib/search-index/build-legal-entity-doc";
import { enrichFirmNameSeedFromPostgres } from "@/lib/provider-osint/firm-name-seed";

function toEnrichmentCandidate(c: V2ExtractionCandidate): EnrichmentCandidate {
  return {
    entityId: c.entityId,
    entityType: c.entityType,
    fieldName: c.fieldName as EnrichmentCandidate["fieldName"],
    extractedValue: c.extractedValue,
    sourceType: c.sourceType,
    sourceUrl: c.sourceUrl,
    extractionMethod: c.extractionMethod as EnrichmentCandidate["extractionMethod"],
    confidence: c.confidence,
    provenanceNote: c.provenanceNote,
  };
}

function signalsFromCandidate(c: V2ExtractionCandidate): ConfidenceSignals {
  return {
    sourceType: c.sourceType,
    rawConfidence: c.confidence,
    officialPage: c.sourceType === "provider_website",
    structuredField: c.extractionMethod === "structured_field",
  };
}

export async function approveAndPersistV2Candidate(
  crawlRunId: string | null,
  candidate: V2ExtractionCandidate,
): Promise<{ approval: V2ApprovalResult; enrichmentId?: string }> {
  const crawlerField =
    candidate.fieldName === "contactPageUrl"
      ? "contact_page"
      : candidate.fieldName === "practiceAreaSlugs"
        ? "practice_areas"
        : candidate.fieldName;

  const regulatory = shouldBlockRegulatoryEnrichment(
    crawlerField,
    candidate.extractedValue,
    candidate.sourceUrl,
  );
  if (regulatory.block) {
    if (candidate.fieldName === "website") {
      await writeV2Record(crawlRunId, candidate, "rejected", candidate.confidence);
    }
    return {
      approval: {
        status: "rejected",
        confidence: candidate.confidence,
        policyDecision: "reject",
        policyReason: REGULATORY_REJECT_REASON,
        auditSample: false,
      },
    };
  }

  if (candidate.fieldName === "website") {
    const typeMatch = candidate.provenanceNote?.match(/candidateType=([a-z_]+)/);
    const candidateType = (typeMatch?.[1] ?? candidate.websiteCandidateType) as
      | import("@/lib/provider-osint/website-candidate-types").WebsiteCandidateType
      | undefined;

    if (candidateType === "heuristic_guess") {
      await writeV2Record(crawlRunId, candidate, "rejected", candidate.confidence);
      return {
        approval: {
          status: "rejected",
          confidence: candidate.confidence,
          policyDecision: "reject",
          policyReason: "heuristic_guess_not_persisted",
          auditSample: false,
        },
      };
    }

    if (
      candidateType &&
      !candidateMayEnterModeration(candidateType, candidate.confidence)
    ) {
      await writeV2Record(crawlRunId, candidate, "rejected", candidate.confidence);
      return {
        approval: {
          status: "rejected",
          confidence: candidate.confidence,
          policyDecision: "reject",
          policyReason: "below_moderation_threshold",
          auditSample: false,
        },
      };
    }

    const obvious = isObviouslySyntheticGeneratedUrl(candidate.extractedValue);
    const doc =
      (await buildSingleSraDocument(candidate.entityId, { skipGeo: true })) ?? null;
    const seed = doc ? await enrichFirmNameSeedFromPostgres(doc) : null;
    const firmName = seed?.primaryName ?? candidate.firmNameUsed ?? "";
    const synthetic =
      obvious.synthetic ||
      isSyntheticWebsiteUrl(candidate.extractedValue, firmName, {
        sraId: seed?.sraId,
        postcode: seed?.postcode,
        city: seed?.city,
      });
    if (synthetic) {
      await writeV2Record(crawlRunId, candidate, "rejected", candidate.confidence);
      return {
        approval: {
          status: "rejected",
          confidence: candidate.confidence,
          policyDecision: "reject",
          policyReason: SYNTHETIC_REJECT_REASON,
          auditSample: false,
        },
      };
    }
  }

  if (candidate.fieldName === "practice_areas" || candidate.fieldName === "practiceAreaSlugs") {
    const gate = gatePracticeAreaLabelOrSlug(
      candidate.practiceLabel ?? candidate.extractedValue,
      candidate.practiceSlug ?? candidate.extractedValue,
    );
    if (!gate.allowed) {
      await writeV2Record(crawlRunId, candidate, "rejected", candidate.confidence);
      return {
        approval: {
          status: "rejected",
          confidence: candidate.confidence,
          policyDecision: "reject",
          policyReason: `${PRACTICE_AREA_TAXONOMY_REJECT_REASON}:${gate.reason}`,
          auditSample: false,
        },
      };
    }
    candidate.extractedValue = gate.slug;
    candidate.practiceSlug = gate.slug;
    candidate.practiceLabel = gate.displayName;
  }

  const enrichmentCandidate = toEnrichmentCandidate(candidate);
  const [existingApproved, officialWebsite, globallyApproved] = await Promise.all([
    loadApprovedRefsForEntity(candidate.entityId),
    loadOfficialWebsiteForEntity(candidate.entityId),
    isGloballyApproved(crawlerField, candidate.extractedValue),
  ]);

  let approval: V2ApprovalResult;
  if (globallyApproved) {
    approval = {
      status: "auto_approved",
      confidence: candidate.confidence,
      policyDecision: "auto_approve",
      policyReason: "global_value_cache",
      auditSample: false,
    };
  } else {
    approval = resolveV2Approval(enrichmentCandidate, signalsFromCandidate(candidate), {
      existingApproved,
      officialWebsiteUrl: officialWebsite,
      reviewCategory: candidate.reviewCategory,
    });
  }

  const status = approval.status as V2RecordStatus;
  await writeV2Record(crawlRunId, candidate, status, approval.confidence);

  const enrichmentId = await syncToProviderEnrichment(
    enrichmentCandidate,
    approval,
  );

  return { approval, enrichmentId };
}

async function syncToProviderEnrichment(
  candidate: EnrichmentCandidate,
  approval: V2ApprovalResult,
): Promise<string | undefined> {
  const validation = validateEnrichmentCandidate(candidate);
  if (!validation.valid) return undefined;

  try {
    const row = await prisma.providerEnrichment.upsert({
      where: {
        entityId_fieldName_extractedValue: {
          entityId: candidate.entityId,
          fieldName: candidate.fieldName,
          extractedValue: candidate.extractedValue,
        },
      },
      create: {
        entityId: candidate.entityId,
        entityType: candidate.entityType,
        fieldName: candidate.fieldName,
        extractedValue: candidate.extractedValue,
        confidence: approval.confidence,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        status: approval.status,
        provenanceNote: candidate.provenanceNote,
        policyDecision: approval.policyDecision,
        policyReason: approval.policyReason,
        auditSample: approval.auditSample,
      },
      update: {
        confidence: approval.confidence,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        status: approval.status,
        provenanceNote: candidate.provenanceNote,
        policyDecision: approval.policyDecision,
        policyReason: approval.policyReason,
        auditSample: approval.auditSample,
        updatedAt: new Date(),
      },
    });

    const finalStatus = row.status as EnrichmentStatus;
    if (finalStatus === "approved" || finalStatus === "auto_approved") {
      const { enqueueProviderForIndexing } = await import("@/lib/ops/enqueue-on-approval");
      await enqueueProviderForIndexing({
        entityId: row.entityId,
        entityType: row.entityType,
        reason: "crawler_v2_auto_approved",
      });
    }
    return row.id;
  } catch {
    return undefined;
  }
}

async function writeV2Record(
  crawlRunId: string | null,
  c: V2ExtractionCandidate,
  status: V2RecordStatus,
  confidence: number,
): Promise<void> {
  const base = {
    crawlRunId,
    entityId: c.entityId,
    entityType: c.entityType,
    confidence,
    sourceType: c.sourceType,
    sourceUrl: c.sourceUrl ?? null,
    extractionMethod: c.extractionMethod,
    status,
  };

  if (c.fieldName === "website") {
    await prisma.providerWebsite.upsert({
      where: { entityId_url: { entityId: c.entityId, url: c.extractedValue } },
      create: { ...base, url: c.extractedValue },
      update: { ...base, updatedAt: new Date() },
    });
    return;
  }

  if (c.fieldName === "phone" || c.fieldName === "email" || c.fieldName === "contactPageUrl") {
    await prisma.providerContact.upsert({
      where: {
        entityId_fieldName_value: {
          entityId: c.entityId,
          fieldName: c.fieldName,
          value: c.extractedValue,
        },
      },
      create: { ...base, fieldName: c.fieldName, value: c.extractedValue },
      update: { ...base, updatedAt: new Date() },
    });
    return;
  }

  if (c.fieldName === "practice_areas" || c.fieldName === "practiceAreaSlugs") {
    const label = c.practiceLabel ?? c.extractedValue;
    await prisma.providerPracticeArea.upsert({
      where: { entityId_label: { entityId: c.entityId, label } },
      create: {
        ...base,
        label,
        slug: c.practiceSlug ?? null,
      },
      update: { ...base, slug: c.practiceSlug ?? null, updatedAt: new Date() },
    });
    return;
  }

  if (c.reviewCategory === "review_signal" || c.signalType) {
    const signalType = c.signalType ?? c.fieldName;
    await prisma.providerReviewSignal.upsert({
      where: {
        entityId_signalType_value: {
          entityId: c.entityId,
          signalType,
          value: c.extractedValue,
        },
      },
      create: { ...base, signalType, value: c.extractedValue },
      update: { ...base, updatedAt: new Date() },
    });
  }
}
