import { prisma } from "@/lib/db/prisma";
import type {
  EnrichmentCandidate,
  EnrichmentStatus,
  ProviderEnrichment,
} from "@/lib/provider-enrichment/types";
import { confidenceForSource } from "@/lib/provider-enrichment/provenance";
import {
  loadApprovedRefsForEntity,
  loadOfficialWebsiteForEntity,
  resolvePolicyStatus,
} from "@/lib/provider-enrichment/submit-with-policy";
import { validateEnrichmentCandidate } from "@/lib/provider-enrichment/validators";

function toRecord(row: {
  id: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceUrl: string | null;
  sourceType: string;
  extractionMethod: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ProviderEnrichment {
  return {
    id: row.id,
    entityId: row.entityId,
    entityType: row.entityType,
    fieldName: row.fieldName,
    extractedValue: row.extractedValue,
    confidence: row.confidence,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceType: row.sourceType as ProviderEnrichment["sourceType"],
    extractionMethod: row.extractionMethod as ProviderEnrichment["extractionMethod"],
    status: row.status as EnrichmentStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function submitEnrichmentCandidate(
  candidate: EnrichmentCandidate,
): Promise<{ status: EnrichmentStatus; id?: string; reason?: string }> {
  const validation = validateEnrichmentCandidate(candidate);
  if (!validation.valid) {
    return { status: "rejected", reason: validation.reason };
  }

  const confidence = confidenceForSource(candidate.sourceType, candidate.confidence);
  const [existingApproved, officialWebsite] = await Promise.all([
    loadApprovedRefsForEntity(candidate.entityId),
    loadOfficialWebsiteForEntity(candidate.entityId),
  ]);

  const resolved = resolvePolicyStatus(candidate, confidence, {
    existingApproved,
    officialWebsiteUrl: officialWebsite,
  });

  if (resolved.status === "rejected") {
    return { status: "rejected", reason: resolved.policyReason };
  }

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
        confidence,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        status: resolved.status,
        provenanceNote: candidate.provenanceNote,
        policyDecision: resolved.policyDecision,
        policyReason: resolved.policyReason,
        auditSample: resolved.auditSample,
      },
      update: {
        confidence,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        status: resolved.status,
        provenanceNote: candidate.provenanceNote,
        policyDecision: resolved.policyDecision,
        policyReason: resolved.policyReason,
        auditSample: resolved.auditSample,
        updatedAt: new Date(),
      },
    });
    const finalStatus = row.status as EnrichmentStatus;
    if (finalStatus === "approved" || finalStatus === "auto_approved") {
      const { enqueueProviderForIndexing } = await import("@/lib/ops/enqueue-on-approval");
      await enqueueProviderForIndexing({
        entityId: row.entityId,
        entityType: row.entityType,
        reason:
          finalStatus === "auto_approved"
            ? "provider_enrichment_auto_approved"
            : "provider_enrichment_approved",
      });
    }
    return { status: finalStatus, id: row.id };
  } catch {
    return { status: "pending_review" };
  }
}

export async function listPendingEnrichments(limit = 100): Promise<ProviderEnrichment[]> {
  try {
    const rows = await prisma.providerEnrichment.findMany({
      where: { status: { in: ["pending_review", "audit_review"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toRecord);
  } catch {
    return [];
  }
}

export async function setEnrichmentStatus(
  id: string,
  status: "approved" | "rejected",
): Promise<boolean> {
  try {
    const row = await prisma.providerEnrichment.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });
    if (status === "approved") {
      const { enqueueProviderForIndexing } = await import("@/lib/ops/enqueue-on-approval");
      await enqueueProviderForIndexing({
        entityId: row.entityId,
        entityType: row.entityType,
        reason: "provider_enrichment_approved",
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function loadApprovedEnrichmentsForEntity(
  entityId: string,
): Promise<ProviderEnrichment[]> {
  try {
    const rows = await prisma.providerEnrichment.findMany({
      where: {
        entityId,
        status: { in: ["approved", "auto_approved"] },
      },
    });
    return rows.map(toRecord);
  } catch {
    return [];
  }
}

export async function loadAllApprovedEnrichments(): Promise<ProviderEnrichment[]> {
  try {
    const rows = await prisma.providerEnrichment.findMany({
      where: { status: { in: ["approved", "auto_approved"] } },
    });
    return rows.map(toRecord);
  } catch {
    return [];
  }
}

export { AUTO_APPROVE_CONFIDENCE } from "@/lib/provider-enrichment/provenance";
