import type { OsintSourceStep } from "@/lib/provider-osint/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";

/** Approved public OSINT source ladder (priority order). */
export const OSINT_SOURCE_LADDER: OsintSourceStep[] = [
  "sra_register",
  "law_society",
  "govuk_legal_aid",
  "official_website",
  "lawworks_probono",
  "curated_source",
  "manual_review",
];

export function planOsintSteps(doc: LegalEntityDocument): OsintSourceStep[] {
  const steps: OsintSourceStep[] = ["sra_register"];

  if (doc.entityType === "sra_organisation") {
    steps.push("law_society");
  }

  steps.push("govuk_legal_aid");

  const hasWebsite =
    Boolean(doc.website?.trim()) || /https?:\/\/[^\s,)]+/i.test(doc.searchText ?? "");
  if (hasWebsite) {
    steps.push("official_website");
  } else {
    steps.push("official_website");
  }

  steps.push("lawworks_probono", "curated_source", "manual_review");
  return [...new Set(steps)];
}
