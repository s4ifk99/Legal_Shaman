import { valuesCanonicallyEqual } from "@/lib/provider-enrichment/value-canonicalization";

export type ApprovedValueRef = {
  fieldName: string;
  extractedValue: string;
  status?: string;
};

export type ConflictCheckResult = {
  hasConflict: boolean;
  conflictingValue?: string;
  sameCanonical: boolean;
};

export function detectValueConflict(
  fieldName: string,
  newValue: string,
  existingApproved: ApprovedValueRef[],
): ConflictCheckResult {
  const sameField = existingApproved.filter(
    (e) =>
      e.fieldName === fieldName ||
      (fieldName === "practice_areas" && e.fieldName === "practiceAreaSlugs") ||
      (fieldName === "practiceAreaSlugs" && e.fieldName === "practice_areas"),
  );

  for (const existing of sameField) {
    if (valuesCanonicallyEqual(fieldName, newValue, existing.extractedValue)) {
      return { hasConflict: false, sameCanonical: true };
    }
    return {
      hasConflict: true,
      conflictingValue: existing.extractedValue,
      sameCanonical: false,
    };
  }

  return { hasConflict: false, sameCanonical: false };
}
