import { prisma } from "@/lib/db/prisma";
import type {
  EnrichmentCandidate,
  EnrichmentStatus,
  ProviderEnrichment,
} from "@/lib/provider-enrichment/types";
import {
  AUTO_APPROVE_CONFIDENCE,
  confidenceForSource,
  shouldAutoApprove,
} from "@/lib/provider-enrichment/provenance";
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
  const autoApprove = shouldAutoApprove(candidate.sourceType, confidence, candidate.fieldName);
  const status: EnrichmentStatus = autoApprove ? "auto_approved" : "pending_review";

  if (!autoApprove && confidence < 0.5) {
    return { status: "rejected", reason: "confidence_too_low" };
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
        status,
        provenanceNote: candidate.provenanceNote,
      },
      update: {
        confidence,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        status: autoApprove ? status : undefined,
        provenanceNote: candidate.provenanceNote,
        updatedAt: new Date(),
      },
    });
    return { status: row.status as EnrichmentStatus, id: row.id };
  } catch {
    return { status: "pending_review" };
  }
}

export async function listPendingEnrichments(limit = 100): Promise<ProviderEnrichment[]> {
  try {
    const rows = await prisma.providerEnrichment.findMany({
      where: { status: "pending_review" },
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
    await prisma.providerEnrichment.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });
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

export { AUTO_APPROVE_CONFIDENCE };
