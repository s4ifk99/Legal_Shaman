import { parseSraWorkAreaField, isKnownSraWorkAreaLabel } from "@/lib/sra/work-area-slugs";
import { collectSraWorkAreaLabels } from "@/lib/search/sra-document";
import { extractPracticeAreaLinesFromSraSearchText } from "@/lib/search/sra-display";
import { slugLabel } from "@/lib/provider-crawler/practice-area-normalizer";
import { projectSraPracticeAreas } from "@/lib/sra/practice-area-projection";

function isInvalidPracticeAreaLabel(label: string): boolean {
  const t = label.trim();
  if (!t || t.length < 2) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^https?:?$/i.test(t)) return true;
  if (/^www\./i.test(t)) return true;
  if (/@/.test(t) && /\./.test(t)) return true;
  if (/^(solicitor|lawyers?|legal services?)$/i.test(t)) return true;
  return false;
}

function addLabel(labels: Set<string>, label: string): void {
  if (!isInvalidPracticeAreaLabel(label)) labels.add(label.trim());
}

/** Collect register labels from work_area column, raw payload, and embedded search_text lines. */
export function collectSraRegisterPracticeAreaLabels(input: {
  workArea?: unknown;
  rawPayload?: unknown;
  searchText?: string;
}): string[] {
  const labels = new Set<string>();

  for (const label of parseSraWorkAreaField(input.workArea)) {
    addLabel(labels, label);
  }

  if (input.rawPayload && typeof input.rawPayload === "object") {
    for (const label of collectSraWorkAreaLabels(input.rawPayload as Record<string, unknown>)) {
      addLabel(labels, label);
    }
  }

  if (input.searchText) {
    for (const label of extractPracticeAreaLinesFromSraSearchText(input.searchText)) {
      addLabel(labels, label);
    }
  }

  return [...labels];
}

/** Firm register + index fields only (no query-inferred labels). */
export function resolveSraPracticeAreaLabels(input: {
  workArea?: unknown;
  rawPayload?: unknown;
  searchText?: string;
}): string[] {
  return collectSraRegisterPracticeAreaLabels(input).slice(0, 12);
}

export type SraPracticeAreaDisplayInput = {
  organisationName: string;
  searchText?: string;
  description?: string;
  workArea?: unknown;
  rawPayload?: unknown;
  /** Previously resolved display labels — preserved when re-mapping legacy rows. */
  existing?: string[];
  enrichmentText?: string;
};

/**
 * Resolve user-visible practice areas for an SRA firm.
 * Uses register data first, then text projection — never the user's query or search-index slugs.
 */
export function resolveSraPracticeAreasForDisplay(input: SraPracticeAreaDisplayInput): string[] {
  const labels = new Set<string>();

  for (const label of input.existing ?? []) {
    addLabel(labels, label);
  }

  for (const label of resolveSraPracticeAreaLabels({
    workArea: input.workArea,
    rawPayload: input.rawPayload,
    searchText: input.searchText,
  })) {
    labels.add(label);
  }

  const registerCount = labels.size;

  if (registerCount < 2) {
    const text = [input.searchText, input.description, input.enrichmentText]
      .filter(Boolean)
      .join("\n");
    const projection = projectSraPracticeAreas({
      organisationName: input.organisationName,
      descriptionText: text,
      enrichmentText: input.enrichmentText,
      practiceKeywords: [...labels],
    });

    for (const slug of projection.practiceAreaSlugs) {
      addLabel(labels, slugLabel(slug));
    }
    for (const name of projection.relatedPracticeAreas) {
      addLabel(labels, name);
    }
  }

  return [...labels].slice(0, 12);
}

/** @deprecated Use resolveSraPracticeAreasForDisplay — kept for call-site compatibility. */
export function mergePracticeAreaLabelsForEntity(input: {
  existing?: string[];
  workArea?: unknown;
  rawPayload?: unknown;
  searchText?: string;
  practiceAreaSlugs?: string[];
  taxonomyAliases?: string[];
  queryTaxonomySlug?: string | null;
  queryPracticeAreaSlug?: string | null;
  organisationName?: string;
  description?: string;
}): string[] {
  return resolveSraPracticeAreasForDisplay({
    organisationName: input.organisationName ?? input.searchText?.split("\n")[0] ?? "SRA organisation",
    searchText: input.searchText,
    description: input.description,
    workArea: input.workArea,
    rawPayload: input.rawPayload,
    existing: [...(input.existing ?? []), ...(input.taxonomyAliases ?? [])],
  });
}

export { isInvalidPracticeAreaLabel, isKnownSraWorkAreaLabel };
