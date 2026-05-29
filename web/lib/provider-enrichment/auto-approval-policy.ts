import { isValidUkPhoneValue } from "@/lib/provider-crawler/extract-contact";
import { detectValueConflict, type ApprovedValueRef } from "@/lib/provider-enrichment/conflict-detection";
import { shouldAuditSample } from "@/lib/provider-enrichment/audit-sampling";
import type { EnrichmentCandidate, EnrichmentFieldName, EnrichmentSourceType } from "@/lib/provider-enrichment/types";
import {
  canonicalPhone,
  canonicalWebsiteOrigin,
  hostMatchesOfficialWebsite,
} from "@/lib/provider-enrichment/value-canonicalization";

export type AutoApprovalDecision =
  | "auto_approve"
  | "sample_review"
  | "manual_review"
  | "reject";

export type AutoApprovalPolicyResult = {
  decision: AutoApprovalDecision;
  reason: string;
  auditSample: boolean;
};

export type PolicyFieldContext = {
  fieldName: string;
  extractedValue: string;
  sourceType: EnrichmentSourceType;
  sourceUrl?: string;
  extractionMethod: string;
  confidence: number;
  provenanceNote?: string;
  reviewCategory?: "field" | "testimonial" | "review_signal";
};

export type AutoApprovalPolicyContext = {
  entityId: string;
  entityType: string;
  field: PolicyFieldContext;
  existingApproved?: ApprovedValueRef[];
  officialWebsiteUrl?: string;
};

const DIRECTORY_SOURCES: EnrichmentSourceType[] = ["external_directory"];
const NEVER_AUTO_FIELDS = new Set([
  "testimonial_snippet",
  "review_aggregate_rating",
  "review_count",
  "trustpilot_profile_url",
]);

const LEGAL_ADVICE_RE = /\b(you should|we recommend|legal advice|guarantee|will win)\b/i;

function isPracticeFromOfficialPage(ctx: PolicyFieldContext): boolean {
  const fn = ctx.fieldName;
  if (fn !== "practice_areas" && fn !== "practiceAreaSlugs") return false;
  if (ctx.sourceType !== "provider_website") return false;
  if (ctx.confidence < 0.9) return false;
  const note = ctx.provenanceNote ?? "";
  const method = ctx.extractionMethod;
  if (method === "html_parse" && /url_slug|services_page|nav_item/i.test(note)) return true;
  if (ctx.sourceUrl && /\/(employment|family|immigration|housing|criminal|conveyancing|injury|law)/i.test(ctx.sourceUrl)) {
    return true;
  }
  return false;
}

function isGovUkSafeField(ctx: PolicyFieldContext): boolean {
  if (ctx.sourceType !== "govuk_legal_aid") return false;
  return (
    ctx.fieldName === "practice_areas" ||
    ctx.fieldName === "practiceAreaSlugs" ||
    ctx.fieldName === "address"
  );
}

function isRegulatedIdentityField(ctx: PolicyFieldContext): boolean {
  if (ctx.sourceType !== "sra_register" && ctx.sourceType !== "law_society") return false;
  return ctx.fieldName === "address" || ctx.fieldName === "website";
}

function isSafePhone(ctx: PolicyFieldContext, officialWebsiteUrl?: string): boolean {
  if (ctx.fieldName !== "phone") return false;
  const e164 = canonicalPhone(ctx.extractedValue);
  if (!e164 || !isValidUkPhoneValue(e164)) return false;
  if (ctx.confidence < 0.9) return false;
  if (DIRECTORY_SOURCES.includes(ctx.sourceType)) return false;
  if (ctx.sourceType === "provider_website" || ctx.sourceType === "law_society") {
    if (ctx.sourceUrl && officialWebsiteUrl) {
      return hostMatchesOfficialWebsite(ctx.sourceUrl, officialWebsiteUrl);
    }
    return ctx.sourceType === "provider_website" && Boolean(ctx.sourceUrl);
  }
  if (ctx.sourceType === "govuk_legal_aid" || ctx.sourceType === "structured_db") return true;
  return false;
}

function isSafeEmail(ctx: PolicyFieldContext, officialWebsiteUrl?: string): boolean {
  if (ctx.fieldName !== "email") return false;
  if (ctx.confidence < 0.9) return false;
  if (DIRECTORY_SOURCES.includes(ctx.sourceType)) return false;
  if (!officialWebsiteUrl && ctx.sourceType !== "govuk_legal_aid") return false;
  return hostMatchesOfficialWebsite(ctx.extractedValue, officialWebsiteUrl);
}

function isSafeWebsite(ctx: PolicyFieldContext): boolean {
  if (ctx.fieldName !== "website") return false;
  if (ctx.confidence < 0.95) return false;
  if (DIRECTORY_SOURCES.includes(ctx.sourceType)) return false;
  if (!ctx.sourceUrl?.trim()) return false;
  const origin = canonicalWebsiteOrigin(ctx.extractedValue);
  if (!origin) return false;
  if (ctx.sourceType === "sra_register" || ctx.sourceType === "law_society") {
    return /domainScore=0\.[7-9]/i.test(ctx.provenanceNote ?? "") || ctx.confidence >= 0.95;
  }
  if (ctx.sourceType === "provider_website") return true;
  return ctx.sourceType === "govuk_legal_aid" || ctx.sourceType === "structured_db";
}

function isInferredWeakPractice(ctx: PolicyFieldContext): boolean {
  if (ctx.fieldName !== "practice_areas" && ctx.fieldName !== "practiceAreaSlugs") return false;
  if (isPracticeFromOfficialPage(ctx)) return false;
  if (ctx.sourceType === "govuk_legal_aid") return false;
  if (ctx.confidence >= 0.9 && ctx.extractionMethod === "structured_field") return false;
  return ctx.confidence < 0.88 || ctx.extractionMethod === "capability_patterns";
}

function guardReject(ctx: PolicyFieldContext): AutoApprovalPolicyResult | null {
  if (!ctx.sourceUrl?.trim() && ["phone", "email", "website", "contact_page", "contactPageUrl"].includes(ctx.fieldName)) {
    return {
      decision: "reject",
      reason: "missing_source_url",
      auditSample: false,
    };
  }

  if (NEVER_AUTO_FIELDS.has(ctx.fieldName)) {
    return { decision: "manual_review", reason: "risky_field_type", auditSample: false };
  }

  if (ctx.reviewCategory && ctx.reviewCategory !== "field") {
    return { decision: "manual_review", reason: "non_field_review_category", auditSample: false };
  }

  if (ctx.sourceType === "trustpilot_api") {
    return { decision: "manual_review", reason: "trustpilot_review_signal", auditSample: false };
  }

  if (LEGAL_ADVICE_RE.test(ctx.extractedValue)) {
    return { decision: "manual_review", reason: "legal_advice_text", auditSample: false };
  }

  if (ctx.confidence < 0.5) {
    return { decision: "reject", reason: "confidence_too_low", auditSample: false };
  }

  return null;
}

function applyMediumBand(
  base: AutoApprovalPolicyResult,
  ctx: AutoApprovalPolicyContext,
): AutoApprovalPolicyResult {
  const c = ctx.field.confidence;
  if (c < 0.75 || c >= 0.9) return base;
  if (base.decision !== "auto_approve") return base;

  const audit = shouldAuditSample({
    entityId: ctx.entityId,
    fieldName: ctx.field.fieldName,
    extractedValue: ctx.field.extractedValue,
    confidence: c,
  });

  if (audit) {
    return {
      decision: "sample_review",
      reason: `${base.reason};medium_confidence_audit_sample`,
      auditSample: true,
    };
  }

  return {
    ...base,
    reason: `${base.reason};medium_confidence_auto`,
    auditSample: false,
  };
}

/**
 * Policy-based auto-approval decision for enrichment / crawl fields.
 */
export function evaluateAutoApprovalPolicy(
  ctx: AutoApprovalPolicyContext,
): AutoApprovalPolicyResult {
  const { field } = ctx;

  const guard = guardReject(field);
  if (guard) return guard;

  const conflict = detectValueConflict(
    field.fieldName,
    field.extractedValue,
    ctx.existingApproved ?? [],
  );
  if (conflict.hasConflict && !conflict.sameCanonical) {
    return {
      decision: "manual_review",
      reason: `conflict_with_approved:${conflict.conflictingValue?.slice(0, 40)}`,
      auditSample: false,
    };
  }

  if (DIRECTORY_SOURCES.includes(field.sourceType)) {
    return {
      decision: "manual_review",
      reason: "directory_only_source",
      auditSample: false,
    };
  }

  if (field.fieldName === "website" && field.confidence < 0.95) {
    return {
      decision: "manual_review",
      reason: "low_confidence_website",
      auditSample: false,
    };
  }

  if (isInferredWeakPractice(field)) {
    return {
      decision: "manual_review",
      reason: "inferred_practice_without_strong_evidence",
      auditSample: false,
    };
  }

  let safe: AutoApprovalPolicyResult | null = null;

  if (isGovUkSafeField(field)) {
    safe = { decision: "auto_approve", reason: "govuk_structured_safe_field", auditSample: false };
  } else if (isRegulatedIdentityField(field)) {
    safe = { decision: "auto_approve", reason: "regulated_register_identity", auditSample: false };
  } else if (isSafePhone(field, ctx.officialWebsiteUrl)) {
    safe = { decision: "auto_approve", reason: "official_domain_valid_phone", auditSample: false };
  } else if (isSafeEmail(field, ctx.officialWebsiteUrl)) {
    safe = { decision: "auto_approve", reason: "email_domain_matches_official_site", auditSample: false };
  } else if (isSafeWebsite(field)) {
    safe = { decision: "auto_approve", reason: "high_confidence_official_website", auditSample: false };
  } else if (isPracticeFromOfficialPage(field)) {
    safe = { decision: "auto_approve", reason: "official_service_page_practice_area", auditSample: false };
  }

  if (safe) return applyMediumBand(safe, ctx);

  if (field.confidence >= 0.75 && field.confidence < 0.9) {
    const audit = shouldAuditSample({
      entityId: ctx.entityId,
      fieldName: field.fieldName,
      extractedValue: field.extractedValue,
      confidence: field.confidence,
    });
    if (audit) {
      return {
        decision: "sample_review",
        reason: "medium_confidence_audit_queue",
        auditSample: true,
      };
    }
  }

  return {
    decision: "manual_review",
    reason: "default_manual_review",
    auditSample: false,
  };
}

export function policyDecisionToStatus(
  decision: AutoApprovalDecision,
): "auto_approved" | "pending_review" | "audit_review" | "rejected" {
  switch (decision) {
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

export function fromEnrichmentCandidate(
  candidate: EnrichmentCandidate,
  confidence: number,
  opts?: {
    existingApproved?: ApprovedValueRef[];
    officialWebsiteUrl?: string;
    reviewCategory?: "field" | "testimonial" | "review_signal";
  },
): AutoApprovalPolicyContext {
  return {
    entityId: candidate.entityId,
    entityType: candidate.entityType,
    field: {
      fieldName: candidate.fieldName,
      extractedValue: candidate.extractedValue,
      sourceType: candidate.sourceType,
      sourceUrl: candidate.sourceUrl,
      extractionMethod: candidate.extractionMethod,
      confidence,
      provenanceNote: candidate.provenanceNote,
      reviewCategory: opts?.reviewCategory,
    },
    existingApproved: opts?.existingApproved,
    officialWebsiteUrl: opts?.officialWebsiteUrl,
  };
}
