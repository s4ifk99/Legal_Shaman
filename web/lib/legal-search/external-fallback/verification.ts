import type { ExternalFallbackResult } from "@/lib/legal-search/external-fallback/types";

const ADVICE_BANNED =
  /\b(you should|you must|we recommend|guarantee|will win|legal advice|definitely eligible)\b/i;

const INVENTED_CLAIMS =
  /\b(offers legal aid|is sra regulated|sra regulated firm|guaranteed legal aid|free representation guaranteed)\b/i;

/** Guardrails: no invented regulation, legal aid, contact details, or advice. */
export function verifyExternalFallbackResult(
  result: ExternalFallbackResult,
): ExternalFallbackResult {
  const warnings: string[] = [...result.verificationNotes];
  let description = result.description ?? "";
  let regulatedStatus = result.regulatedStatus;
  let fundingType = result.fundingType;

  if (ADVICE_BANNED.test(description)) {
    warnings.push("removed_advice_language");
    description = description.replace(ADVICE_BANNED, "").trim();
  }

  if (INVENTED_CLAIMS.test(description)) {
    warnings.push("removed_unverified_claims");
    description = description.replace(INVENTED_CLAIMS, "").trim();
    regulatedStatus = "unknown";
    fundingType = "unknown";
  }

  if (result.source !== "sra_register" && result.source !== "law_society") {
    if (regulatedStatus === "sra_regulated") {
      warnings.push("regulated_status_downgraded");
      regulatedStatus = "unknown";
    }
  }

  if (result.source !== "govuk_legal_aid") {
    if (fundingType === "legal_aid") {
      warnings.push("legal_aid_claim_downgraded");
      fundingType = "unknown";
    }
  }

  if (/\b\d{3,}\s?\d{3,}\s?\d{3,}\b/.test(description)) {
    warnings.push("removed_phone_from_description");
    description = description.replace(/\b\d{3,}\s?\d{3,}\s?\d{3,}\b/g, "").trim();
  }

  if (/\£\d+/.test(description)) {
    warnings.push("removed_price_from_description");
    description = description.replace(/\£\d+[^\s]*/g, "").trim();
  }

  const confidence = Math.min(result.confidence, warnings.length > 2 ? 0.65 : 0.85);

  return {
    ...result,
    description: description || undefined,
    regulatedStatus,
    fundingType,
    confidence,
    verificationNotes: [...new Set(warnings)],
  };
}

export function externalCopyPassesSafety(text: string): boolean {
  return text.trim().length > 0 && !ADVICE_BANNED.test(text);
}

export function verifyExternalFallbackBatch(
  results: ExternalFallbackResult[],
): { results: ExternalFallbackResult[]; warnings: string[] } {
  const allWarnings: string[] = [];
  const verified = results.map((r) => {
    const v = verifyExternalFallbackResult(r);
    for (const w of v.verificationNotes) {
      if (!r.verificationNotes.includes(w)) allWarnings.push(`${r.id}:${w}`);
    }
    return v;
  });
  return { results: verified, warnings: allWarnings };
}
