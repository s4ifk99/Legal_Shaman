import { isKnownCapability } from "@/lib/provider-intelligence/capability-taxonomy";
import type { EnrichmentCandidate } from "@/lib/provider-enrichment/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Reject obvious placeholder / invented contact values. */
export function validateEnrichmentCandidate(candidate: EnrichmentCandidate): {
  valid: boolean;
  reason?: string;
} {
  const v = candidate.extractedValue.trim();
  if (!v) return { valid: false, reason: "empty" };

  if (candidate.fieldName === "phone") {
    if (/^(0{6,}|123456|00000|99999|0123456789)$/i.test(v.replace(/\D/g, ""))) {
      return { valid: false, reason: "placeholder_phone" };
    }
    if (v.length < 8) return { valid: false, reason: "phone_too_short" };
  }

  if (candidate.fieldName === "email") {
    if (!EMAIL_RE.test(v)) return { valid: false, reason: "invalid_email" };
    if (/example\.(com|org)|@test\./i.test(v)) return { valid: false, reason: "placeholder_email" };
  }

  if (candidate.fieldName === "website") {
    if (!/^https?:\/\//i.test(v) && !/^[a-z0-9.-]+\.[a-z]{2,}/i.test(v)) {
      return { valid: false, reason: "invalid_website" };
    }
  }

  if (candidate.fieldName === "contactPageUrl") {
    if (!/^https?:\/\//i.test(v)) return { valid: false, reason: "invalid_contact_page" };
  }

  if (candidate.fieldName === "practiceAreaSlugs") {
    const slugs = v.split(",").map((s) => s.trim()).filter(Boolean);
    if (!slugs.length) return { valid: false, reason: "no_slugs" };
    for (const s of slugs) {
      if (!/^[a-z][a-z0-9_]*$/i.test(s)) {
        return { valid: false, reason: `invalid_slug:${s}` };
      }
    }
  }

  const capabilityFields = new Set([
    "capabilities",
    "fundingCapabilities",
    "urgencyCapabilities",
    "accessibilityCapabilities",
    "languages",
    "tribunalCapabilities",
  ]);
  if (capabilityFields.has(candidate.fieldName)) {
    const slugs = v.split(",").map((s) => s.trim()).filter(Boolean);
    if (!slugs.length) return { valid: false, reason: "no_capabilities" };
    for (const s of slugs) {
      if (candidate.fieldName === "languages") {
        if (!/^[a-z]{2,20}$/i.test(s)) return { valid: false, reason: `invalid_language:${s}` };
      } else if (!isKnownCapability(s)) {
        return { valid: false, reason: `unknown_capability:${s}` };
      }
    }
  }

  if (candidate.confidence < 0 || candidate.confidence > 1) {
    return { valid: false, reason: "confidence_out_of_range" };
  }

  return { valid: true };
}
