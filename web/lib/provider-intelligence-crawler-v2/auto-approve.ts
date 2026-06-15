import {
  evaluateAutoApprovalPolicy,
  fromEnrichmentCandidate,
  type AutoApprovalPolicyResult,
} from "@/lib/provider-enrichment/auto-approval-policy";
import type { EnrichmentCandidate, EnrichmentStatus } from "@/lib/provider-enrichment/types";
import {
  computeV2Confidence,
  qualifiesV2AutoApprove,
  type ConfidenceSignals,
} from "@/lib/provider-intelligence-crawler-v2/confidence";
import type { ApprovedValueRef } from "@/lib/provider-enrichment/conflict-detection";

export type V2ApprovalResult = {
  status: EnrichmentStatus;
  confidence: number;
  policyDecision: string;
  policyReason: string;
  auditSample: boolean;
};

export function resolveV2Approval(
  candidate: EnrichmentCandidate,
  signals: ConfidenceSignals,
  opts?: {
    existingApproved?: ApprovedValueRef[];
    officialWebsiteUrl?: string;
    reviewCategory?: "field" | "testimonial" | "review_signal";
  },
): V2ApprovalResult {
  const confidence = computeV2Confidence(signals);
  const policy: AutoApprovalPolicyResult = evaluateAutoApprovalPolicy(
    fromEnrichmentCandidate(candidate, confidence, {
      existingApproved: opts?.existingApproved,
      officialWebsiteUrl: opts?.officialWebsiteUrl,
      reviewCategory: opts?.reviewCategory,
    }),
  );

  if (policy.decision === "reject") {
    return {
      status: "rejected",
      confidence,
      policyDecision: policy.decision,
      policyReason: policy.reason,
      auditSample: policy.auditSample,
    };
  }

  if (qualifiesV2AutoApprove(candidate.fieldName, confidence)) {
    return {
      status: "auto_approved",
      confidence,
      policyDecision: "auto_approve",
      policyReason: `v2_confidence>=${0.95}_contact_field`,
      auditSample: false,
    };
  }

  return {
    status: policy.decision === "auto_approve" ? "pending_review" : mapPolicyToStatus(policy),
    confidence,
    policyDecision: "manual_review",
    policyReason: "v2_queued_for_moderation",
    auditSample: policy.auditSample,
  };
}

function mapPolicyToStatus(policy: AutoApprovalPolicyResult): EnrichmentStatus {
  switch (policy.decision) {
    case "auto_approve":
      return "auto_approved";
    case "sample_review":
      return "audit_review";
    case "reject":
      return "rejected";
    default:
      return "pending_review";
  }
}
