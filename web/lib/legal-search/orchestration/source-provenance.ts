import type { SearchResult } from "@/lib/legal-search/types";

/** User-facing source labels (policy §7 — no “verified” / “trusted”). */
export type SourceProvenanceLabel =
  | "GOV.UK legal aid data"
  | "SRA-regulated organisation"
  | "Curated directory listing"
  | "Law centre"
  | "Law Society directory"
  | "External signposting source"
  | "Directory listing";

function entityTypeOf(r: SearchResult): string {
  const raw = r.raw as { entityType?: string; source?: string } | null;
  return String(raw?.entityType ?? "");
}

/**
 * Map a search hit to a transparent provenance label for UI copy.
 */
export function sourceProvenanceLabel(result: SearchResult): SourceProvenanceLabel {
  const et = entityTypeOf(result);
  const raw = result.raw as { source?: string; externalSource?: string } | null;
  const external = raw?.externalSource ?? raw?.source;

  if (external === "govuk_legal_aid" || result.source === "legal_aid") {
    if (et === "law_centre") return "Law centre";
    return "GOV.UK legal aid data";
  }
  if (external === "law_society") return "Law Society directory";
  if (external === "sra_register" || et === "sra_organisation" || result.source === "sra") {
    return "SRA-regulated organisation";
  }
  if (et === "law_centre") return "Law centre";
  if (
    et === "pro_bono_organisation" ||
    et === "advice_charity" ||
    et === "university_law_clinic" ||
    result.source === "curated_listing"
  ) {
    return "Curated directory listing";
  }
  if (et === "legal_aid_provider") return "GOV.UK legal aid data";
  if (result.source === "lawyer" || result.source === "firm") {
    return "Directory listing";
  }
  if (raw?.externalSource) return "External signposting source";

  switch (result.source) {
    case "legal_aid":
      return "GOV.UK legal aid data";
    case "sra":
      return "SRA-regulated organisation";
    case "curated_listing":
      return "Curated directory listing";
    default:
      return "Directory listing";
  }
}

/** Banned user-facing trust phrases (policy §7). */
export const BANNED_TRUST_LABELS = /\b(verified|trusted)\b/i;

export function userFacingSourceLine(result: SearchResult): string {
  return `Source: ${sourceProvenanceLabel(result)}`;
}
