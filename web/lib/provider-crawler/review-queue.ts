import { prisma } from "@/lib/db/prisma";
import { validateEnrichmentCandidate } from "@/lib/provider-enrichment/validators";
import { submitEnrichmentCandidate } from "@/lib/provider-enrichment/review-queue";
import type { EnrichmentCandidate, EnrichmentFieldName } from "@/lib/provider-enrichment/types";
import {
  crawlConfidenceForSource,
  shouldAutoApproveCrawlField,
} from "@/lib/provider-crawler/provenance";
import type {
  ExtractedFieldCandidate,
  FieldStatus,
  ReviewCategory,
} from "@/lib/provider-crawler/types";

const FIELD_TO_ENRICHMENT: Partial<Record<string, EnrichmentFieldName>> = {
  phone: "phone",
  email: "email",
  website: "website",
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
  const autoApprove = shouldAutoApproveCrawlField(
    candidate.sourceType,
    confidence,
    candidate.fieldName,
    reviewCategory,
  );
  const status: FieldStatus = autoApprove ? "auto_approved" : "pending_review";

  if (!autoApprove && confidence < 0.5) {
    return { status: "rejected", reason: "confidence_too_low" };
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
        extractedAt: candidate.extractedAt ?? new Date(),
      },
      update: {
        confidence,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        status: autoApprove ? status : undefined,
        provenanceNote: candidate.provenanceNote,
        extractedAt: candidate.extractedAt ?? new Date(),
        updatedAt: new Date(),
      },
    });

    if (autoApprove && enrichment) {
      await syncFieldToEnrichment(enrichment, "auto_approved");
    }

    return { status: row.status as FieldStatus, id: row.id };
  } catch {
    return { status: "pending_review" };
  }
}

async function syncFieldToEnrichment(
  candidate: EnrichmentCandidate,
  forceStatus?: "approved" | "auto_approved",
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
        },
        update: {
          status: forceStatus,
          confidence,
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
  limit = 200,
  reviewCategory?: ReviewCategory,
): Promise<PendingExtractedField[]> {
  try {
    const rows = await prisma.providerExtractedField.findMany({
      where: {
        status: "pending_review",
        ...(reviewCategory ? { reviewCategory } : {}),
      },
      orderBy: { createdAt: "desc" },
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
