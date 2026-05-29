import { prisma } from "@/lib/db/prisma";
import { validateEnrichmentCandidate } from "@/lib/provider-enrichment/validators";
import { submitEnrichmentCandidate } from "@/lib/provider-enrichment/review-queue";
import type { EnrichmentCandidate, EnrichmentFieldName } from "@/lib/provider-enrichment/types";
import { crawlConfidenceForSource } from "@/lib/provider-crawler/provenance";
import {
  evaluateAutoApprovalPolicy,
  policyDecisionToStatus,
} from "@/lib/provider-enrichment/auto-approval-policy";
import {
  loadApprovedRefsForEntity,
  loadOfficialWebsiteForEntity,
  resolvePolicyStatus,
} from "@/lib/provider-enrichment/submit-with-policy";
import type {
  ExtractedFieldCandidate,
  FieldStatus,
  ReviewCategory,
} from "@/lib/provider-crawler/types";

const FIELD_TO_ENRICHMENT: Partial<Record<string, EnrichmentFieldName>> = {
  phone: "phone",
  email: "email",
  website: "website",
  contact_page: "contactPageUrl",
  opening_hours: "openingHours",
  address: "address",
  practice_areas: "practiceAreaSlugs",
  capabilities: "capabilities",
  fundingCapabilities: "fundingCapabilities",
  urgencyCapabilities: "urgencyCapabilities",
  accessibilityCapabilities: "accessibilityCapabilities",
  languages: "languages",
  tribunalCapabilities: "tribunalCapabilities",
};

function toEnrichmentCandidate(c: ExtractedFieldCandidate): EnrichmentCandidate | null {
  const fieldName = FIELD_TO_ENRICHMENT[c.fieldName];
  if (!fieldName) return null;
  return {
    entityId: c.entityId,
    entityType: c.entityType,
    fieldName,
    extractedValue: c.extractedValue,
    confidence: c.confidence,
    sourceUrl: c.sourceUrl,
    sourceType: c.sourceType as EnrichmentCandidate["sourceType"],
    extractionMethod: c.extractionMethod as EnrichmentCandidate["extractionMethod"],
    provenanceNote: c.provenanceNote,
  };
}

export async function persistExtractedField(
  candidate: ExtractedFieldCandidate,
  crawlResultId?: string,
): Promise<{ status: FieldStatus; id?: string; reason?: string }> {
  const reviewCategory: ReviewCategory = candidate.reviewCategory ?? "field";
  const enrichment = toEnrichmentCandidate(candidate);

  if (enrichment) {
    const validation = validateEnrichmentCandidate(enrichment);
    if (!validation.valid) return { status: "rejected", reason: validation.reason };
  } else if (!candidate.extractedValue.trim()) {
    return { status: "rejected", reason: "empty" };
  }

  const confidence = crawlConfidenceForSource(candidate.sourceType, candidate.confidence);

  let status: FieldStatus = "pending_review";
  let policyDecision: string | undefined;
  let policyReason: string | undefined;
  let auditSample = false;

  if (enrichment) {
    const [existingApproved, officialWebsite] = await Promise.all([
      loadApprovedRefsForEntity(candidate.entityId),
      loadOfficialWebsiteForEntity(candidate.entityId),
    ]);
    const resolved = resolvePolicyStatus(enrichment, confidence, {
      existingApproved,
      officialWebsiteUrl: officialWebsite,
      reviewCategory,
    });
    if (resolved.status === "rejected") {
      return { status: "rejected", reason: resolved.policyReason };
    }
    status = resolved.status as FieldStatus;
    policyDecision = resolved.policyDecision;
    policyReason = resolved.policyReason;
    auditSample = resolved.auditSample;
  } else {
    const [existingApproved, officialWebsite] = await Promise.all([
      loadApprovedRefsForEntity(candidate.entityId),
      loadOfficialWebsiteForEntity(candidate.entityId),
    ]);
    const policy = evaluateAutoApprovalPolicy({
      entityId: candidate.entityId,
      entityType: candidate.entityType,
      field: {
        fieldName: candidate.fieldName,
        extractedValue: candidate.extractedValue,
        sourceType: candidate.sourceType as EnrichmentCandidate["sourceType"],
        sourceUrl: candidate.sourceUrl,
        extractionMethod: candidate.extractionMethod,
        confidence,
        provenanceNote: candidate.provenanceNote,
        reviewCategory,
      },
      existingApproved,
      officialWebsiteUrl: officialWebsite,
    });
    if (policy.decision === "reject") {
      return { status: "rejected", reason: policy.reason };
    }
    status = policyDecisionToStatus(policy.decision) as FieldStatus;
    policyDecision = policy.decision;
    policyReason = policy.reason;
    auditSample = policy.auditSample;
  }

  try {
    const row = await prisma.providerExtractedField.upsert({
      where: {
        entityId_fieldName_extractedValue_reviewCategory: {
          entityId: candidate.entityId,
          fieldName: candidate.fieldName,
          extractedValue: candidate.extractedValue,
          reviewCategory,
        },
      },
      create: {
        crawlResultId,
        entityId: candidate.entityId,
        entityType: candidate.entityType,
        fieldName: candidate.fieldName,
        extractedValue: candidate.extractedValue,
        confidence,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        reviewCategory,
        status,
        provenanceNote: candidate.provenanceNote,
        policyDecision,
        policyReason,
        auditSample,
        extractedAt: candidate.extractedAt ?? new Date(),
      },
      update: {
        confidence,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        status,
        provenanceNote: candidate.provenanceNote,
        policyDecision,
        policyReason,
        auditSample,
        extractedAt: candidate.extractedAt ?? new Date(),
        updatedAt: new Date(),
      },
    });

    if (status === "auto_approved" && enrichment) {
      await syncFieldToEnrichment(enrichment, "auto_approved", {
        policyDecision,
        policyReason,
        auditSample,
      });
    }

    return { status: row.status as FieldStatus, id: row.id };
  } catch {
    return { status: "pending_review" };
  }
}

async function syncFieldToEnrichment(
  candidate: EnrichmentCandidate,
  forceStatus?: "approved" | "auto_approved",
  policyMeta?: { policyDecision?: string; policyReason?: string; auditSample?: boolean },
): Promise<void> {
  if (forceStatus === "approved" || forceStatus === "auto_approved") {
    const confidence = crawlConfidenceForSource(
      candidate.sourceType as ExtractedFieldCandidate["sourceType"],
      candidate.confidence,
    );
    try {
      await prisma.providerEnrichment.upsert({
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
          confidence,
          sourceUrl: candidate.sourceUrl,
          sourceType: candidate.sourceType,
          extractionMethod: candidate.extractionMethod,
          status: forceStatus,
          provenanceNote: candidate.provenanceNote,
          policyDecision: policyMeta?.policyDecision,
          policyReason: policyMeta?.policyReason,
          auditSample: policyMeta?.auditSample ?? false,
        },
        update: {
          status: forceStatus,
          confidence,
          policyDecision: policyMeta?.policyDecision,
          policyReason: policyMeta?.policyReason,
          auditSample: policyMeta?.auditSample,
          updatedAt: new Date(),
        },
      });
    } catch {
      await submitEnrichmentCandidate(candidate);
    }
    return;
  }
  await submitEnrichmentCandidate(candidate);
}

export async function setExtractedFieldStatus(
  id: string,
  status: "approved" | "rejected",
): Promise<boolean> {
  try {
    const row = await prisma.providerExtractedField.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });

    const enrichment = toEnrichmentCandidate({
      entityId: row.entityId,
      entityType: row.entityType,
      fieldName: row.fieldName as ExtractedFieldCandidate["fieldName"],
      extractedValue: row.extractedValue,
      confidence: row.confidence,
      sourceUrl: row.sourceUrl ?? undefined,
      sourceType: row.sourceType as ExtractedFieldCandidate["sourceType"],
      extractionMethod: row.extractionMethod as ExtractedFieldCandidate["extractionMethod"],
      provenanceNote: row.provenanceNote ?? undefined,
    });

    if (status === "approved" && enrichment) {
      await syncFieldToEnrichment(enrichment, "approved");
      const { enqueueProviderForIndexing } = await import("@/lib/ops/enqueue-on-approval");
      await enqueueProviderForIndexing({
        entityId: row.entityId,
        entityType: row.entityType,
        reason: "crawler_field_approved",
      });
    }

    return true;
  } catch {
    return false;
  }
}

export type PendingExtractedField = {
  id: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceUrl?: string;
  sourceType: string;
  extractionMethod: string;
  reviewCategory: string;
  status: string;
  extractedAt: string;
  provenanceNote?: string;
};

export async function countProviderExtractedFields(): Promise<{
  total: number;
  pending: number;
}> {
  try {
    const [total, pending] = await Promise.all([
      prisma.providerExtractedField.count(),
      prisma.providerExtractedField.count({ where: { status: "pending_review" } }),
    ]);
    return { total, pending };
  } catch {
    return { total: -1, pending: -1 };
  }
}

export async function listPendingExtractedFields(
  limit = 500,
  reviewCategory?: ReviewCategory,
): Promise<PendingExtractedField[]> {
  try {
    const rows = await prisma.providerExtractedField.findMany({
      where: {
        status: { in: ["pending_review", "audit_review"] },
        ...(reviewCategory ? { reviewCategory } : {}),
      },
      orderBy: [{ extractedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      entityId: r.entityId,
      entityType: r.entityType,
      fieldName: r.fieldName,
      extractedValue: r.extractedValue,
      confidence: r.confidence,
      sourceUrl: r.sourceUrl ?? undefined,
      sourceType: r.sourceType,
      extractionMethod: r.extractionMethod,
      reviewCategory: r.reviewCategory,
      status: r.status,
      extractedAt: r.extractedAt.toISOString(),
      provenanceNote: r.provenanceNote ?? undefined,
    }));
  } catch {
    return [];
  }
}

export async function queueCrawlJob(
  entityId: string,
  entityType: string,
  mode: string,
  targetUrl?: string,
): Promise<string | null> {
  try {
    const job = await prisma.providerCrawlJob.create({
      data: {
        entityId,
        entityType,
        mode,
        targetUrl,
        status: "queued",
      },
    });
    return job.id;
  } catch {
    return null;
  }
}

export async function bulkSetExtractedFieldStatus(
  ids: string[],
  status: "approved" | "rejected",
): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    if (await setExtractedFieldStatus(id, status)) ok.push(id);
    else failed.push(id);
  }
  return { ok, failed };
}

export async function listQueuedCrawlJobs(limit = 50) {
  try {
    return await prisma.providerCrawlJob.findMany({
      where: { status: "queued" },
      orderBy: { scheduledAt: "asc" },
      take: limit,
    });
  } catch {
    return [];
  }
}
