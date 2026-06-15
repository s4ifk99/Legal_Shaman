import { prisma } from "@/lib/db/prisma";
import {
  evaluateAutoApprovalPolicy,
  fromEnrichmentCandidate,
  policyDecisionToStatus,
} from "@/lib/provider-enrichment/auto-approval-policy";
import { confidenceForSource } from "@/lib/provider-enrichment/provenance";
import { isValidUkPhoneValue } from "@/lib/provider-crawler/extract-contact";
import { canonicalPhone, hostMatchesOfficialWebsite } from "@/lib/provider-enrichment/value-canonicalization";
import type { EnrichmentCandidate } from "@/lib/provider-enrichment/types";
import { detectValueConflict } from "@/lib/provider-enrichment/conflict-detection";

export type BulkActionResult = {
  processed: number;
  approved: number;
  rejected: number;
  skipped: number;
  ids: string[];
};

async function loadApprovedRefs(entityId: string) {
  const rows = await prisma.providerEnrichment.findMany({
    where: {
      entityId,
      status: { in: ["approved", "auto_approved"] },
    },
    select: { fieldName: true, extractedValue: true },
  });
  return rows;
}

async function officialWebsiteForEntity(entityId: string): Promise<string | undefined> {
  const row = await prisma.providerEnrichment.findFirst({
    where: {
      entityId,
      fieldName: "website",
      status: { in: ["approved", "auto_approved"] },
    },
    orderBy: { confidence: "desc" },
  });
  return row?.extractedValue;
}

function rowToCandidate(row: {
  entityId: string;
  entityType: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
  sourceUrl: string | null;
  sourceType: string;
  extractionMethod: string;
  provenanceNote: string | null;
}): EnrichmentCandidate {
  return {
    entityId: row.entityId,
    entityType: row.entityType,
    fieldName: row.fieldName as EnrichmentCandidate["fieldName"],
    extractedValue: row.extractedValue,
    confidence: row.confidence,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceType: row.sourceType as EnrichmentCandidate["sourceType"],
    extractionMethod: row.extractionMethod as EnrichmentCandidate["extractionMethod"],
    provenanceNote: row.provenanceNote ?? undefined,
  };
}

/** Auto-approve pending GOV.UK practice area / address fields. */
export async function bulkAutoApproveGovUkStructured(limit = 500): Promise<BulkActionResult> {
  const rows = await prisma.providerEnrichment.findMany({
    where: {
      status: { in: ["pending_review", "audit_review"] },
      sourceType: "govuk_legal_aid",
      fieldName: { in: ["practiceAreaSlugs", "address", "practice_areas"] },
    },
    take: limit,
  });
  return applyPolicyBulk(rows);
}

/** Auto-approve valid phones from official provider website sources. */
export async function bulkAutoApproveOfficialContacts(limit = 500): Promise<BulkActionResult> {
  const rows = await prisma.providerEnrichment.findMany({
    where: {
      status: { in: ["pending_review", "audit_review"] },
      fieldName: { in: ["phone", "email"] },
      sourceType: { in: ["provider_website", "law_society"] },
    },
    take: limit,
  });

  const result: BulkActionResult = {
    processed: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
    ids: [],
  };

  for (const row of rows) {
    result.processed++;
    const official = await officialWebsiteForEntity(row.entityId);
    if (row.fieldName === "phone") {
      const e164 = canonicalPhone(row.extractedValue);
      if (!e164 || !isValidUkPhoneValue(e164)) {
        result.skipped++;
        continue;
      }
      if (row.sourceUrl && official && !hostMatchesOfficialWebsite(row.sourceUrl, official)) {
        result.skipped++;
        continue;
      }
    }
    if (row.fieldName === "email" && official && !hostMatchesOfficialWebsite(row.extractedValue, official)) {
      result.skipped++;
      continue;
    }

    const approved = await prisma.providerEnrichment.update({
      where: { id: row.id },
      data: {
        status: "auto_approved",
        policyDecision: "auto_approve",
        policyReason: "bulk:official_domain_contact",
        auditSample: false,
      },
    });
    if (approved) {
      result.approved++;
      result.ids.push(row.id);
    }
  }

  return result;
}

/** Policy auto-approve all pending where decision is auto_approve and no conflict. */
export async function bulkAutoApproveHighConfidenceNonConflicting(
  limit = 500,
): Promise<BulkActionResult> {
  const rows = await prisma.providerEnrichment.findMany({
    where: { status: { in: ["pending_review", "audit_review"] } },
    take: limit,
  });
  return applyPolicyBulk(rows);
}

async function applyPolicyBulk(
  rows: Awaited<ReturnType<typeof prisma.providerEnrichment.findMany>>,
): Promise<BulkActionResult> {
  const result: BulkActionResult = {
    processed: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
    ids: [],
  };

  for (const row of rows) {
    result.processed++;
    const existing = await loadApprovedRefs(row.entityId);
    const conflict = detectValueConflict(row.fieldName, row.extractedValue, existing);
    if (conflict.hasConflict && !conflict.sameCanonical) {
      result.skipped++;
      continue;
    }

    const candidate = rowToCandidate(row);
    const confidence = confidenceForSource(candidate.sourceType, candidate.confidence);
    const official = await officialWebsiteForEntity(row.entityId);
    const policy = evaluateAutoApprovalPolicy(
      fromEnrichmentCandidate(candidate, confidence, {
        existingApproved: existing,
        officialWebsiteUrl: official,
      }),
    );

    if (policy.decision !== "auto_approve") {
      result.skipped++;
      continue;
    }

    await prisma.providerEnrichment.update({
      where: { id: row.id },
      data: {
        status: policyDecisionToStatus(policy.decision),
        policyDecision: policy.decision,
        policyReason: `bulk:${policy.reason}`,
        auditSample: policy.auditSample,
      },
    });
    result.approved++;
    result.ids.push(row.id);
  }

  return result;
}

/** Promote audit_review queue items to pending for human review (sample audit). */
export async function bulkSendAuditSampleToReview(limit = 200): Promise<BulkActionResult> {
  const rows = await prisma.providerEnrichment.findMany({
    where: { status: "audit_review", auditSample: true },
    take: limit,
  });

  const result: BulkActionResult = {
    processed: rows.length,
    approved: 0,
    rejected: 0,
    skipped: 0,
    ids: [],
  };

  for (const row of rows) {
    await prisma.providerEnrichment.update({
      where: { id: row.id },
      data: { status: "pending_review" },
    });
    result.ids.push(row.id);
  }

  return result;
}

/** Reject duplicate extras: same entity+field with lower confidence when approved exists. */
export async function bulkRejectDuplicateExtras(limit = 500): Promise<BulkActionResult> {
  const pending = await prisma.providerEnrichment.findMany({
    where: { status: { in: ["pending_review", "audit_review"] } },
    orderBy: [{ entityId: "asc" }, { fieldName: "asc" }, { confidence: "desc" }],
    take: limit,
  });

  const result: BulkActionResult = {
    processed: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
    ids: [],
  };

  const approvedByKey = new Map<string, { confidence: number }>();

  const approved = await prisma.providerEnrichment.findMany({
    where: { status: { in: ["approved", "auto_approved"] } },
    select: { entityId: true, fieldName: true, confidence: true },
  });
  for (const a of approved) {
    approvedByKey.set(`${a.entityId}|${a.fieldName}`, { confidence: a.confidence });
  }

  for (const row of pending) {
    result.processed++;
    const key = `${row.entityId}|${row.fieldName}`;
    const best = approvedByKey.get(key);
    if (!best) continue;
    if (row.confidence < best.confidence - 0.01) {
      await prisma.providerEnrichment.update({
        where: { id: row.id },
        data: {
          status: "rejected",
          policyDecision: "reject",
          policyReason: "bulk:duplicate_lower_confidence",
        },
      });
      result.rejected++;
      result.ids.push(row.id);
    }
  }

  return result;
}
