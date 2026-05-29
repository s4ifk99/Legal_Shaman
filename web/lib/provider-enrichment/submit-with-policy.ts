import { prisma } from "@/lib/db/prisma";
import {
  evaluateAutoApprovalPolicy,
  fromEnrichmentCandidate,
  policyDecisionToStatus,
} from "@/lib/provider-enrichment/auto-approval-policy";
import { confidenceForSource } from "@/lib/provider-enrichment/provenance";
import type { EnrichmentCandidate, EnrichmentStatus } from "@/lib/provider-enrichment/types";

export async function loadApprovedRefsForEntity(entityId: string) {
  try {
    const rows = await prisma.providerEnrichment.findMany({
      where: {
        entityId,
        status: { in: ["approved", "auto_approved"] },
      },
      select: { fieldName: true, extractedValue: true, status: true },
    });
    return rows;
  } catch {
    return [];
  }
}

export async function loadOfficialWebsiteForEntity(
  entityId: string,
): Promise<string | undefined> {
  try {
    const row = await prisma.providerEnrichment.findFirst({
      where: {
        entityId,
        fieldName: "website",
        status: { in: ["approved", "auto_approved"] },
      },
      orderBy: { confidence: "desc" },
    });
    return row?.extractedValue;
  } catch {
    return undefined;
  }
}

export function resolvePolicyStatus(
  candidate: EnrichmentCandidate,
  adjustedConfidence: number,
  opts?: {
    existingApproved?: Awaited<ReturnType<typeof loadApprovedRefsForEntity>>;
    officialWebsiteUrl?: string;
    reviewCategory?: "field" | "testimonial" | "review_signal";
  },
): {
  status: EnrichmentStatus;
  policyDecision: string;
  policyReason: string;
  auditSample: boolean;
} {
  const policy = evaluateAutoApprovalPolicy(
    fromEnrichmentCandidate(candidate, adjustedConfidence, {
      existingApproved: opts?.existingApproved,
      officialWebsiteUrl: opts?.officialWebsiteUrl,
      reviewCategory: opts?.reviewCategory,
    }),
  );

  return {
    status: policyDecisionToStatus(policy.decision),
    policyDecision: policy.decision,
    policyReason: policy.reason,
    auditSample: policy.auditSample,
  };
}
