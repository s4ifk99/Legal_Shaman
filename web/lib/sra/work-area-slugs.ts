import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import {
  normalizePracticeAreas,
  slugLabel,
} from "@/lib/provider-crawler/practice-area-normalizer";
import type { LegalEntityDocument } from "@/lib/search-index/types";

const bySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));

/** Normalised (lowercase) SRA register WorkArea label → taxonomy slug. */
const SRA_WORK_AREA_EXACT: Record<string, string> = {
  "administrative and public law": "public_law",
  "children": "family",
  "civil liberties and human rights": "human_rights",
  "civil litigation": "commercial",
  "clinical negligence": "clinical_negligence",
  "community care": "community_care",
  "company and commercial": "commercial",
  "consumer": "consumer",
  "consumer and retail": "consumer",
  "consumer credit": "consumer_credit_loans",
  "e-commerce": "consumer_online_shopping",
  "retail": "consumer_goods",
  "crime": "criminal_defence",
  "criminal defence": "criminal_defence",
  "debt": "debt",
  "debt and bankruptcy": "debt",
  "education": "education",
  "employment": "employment",
  "family": "family",
  "family / matrimonial": "family",
  "family/matrimonial": "family",
  "family/matrimonial and childcare": "family",
  "health and community care": "community_care",
  "housing": "housing",
  "housing/landlord and tenant": "housing",
  "immigration": "immigration",
  "immigration and asylum": "immigration",
  "insolvency": "insolvency",
  "intellectual property": "intellectual_property",
  "matrimonial": "family",
  "mental health": "mental_health",
  "motoring": "motoring_offences",
  "motoring offences": "motoring_offences",
  "personal injury": "personal_injury",
  "personal injury/l clinical negligence": "personal_injury",
  "planning": "planning_law",
  "defamation": "defamation_media",
  "media and entertainment": "defamation_media",
  "construction": "construction_law",
  "environmental": "environmental_law",
  "data protection": "data_protection",
  "charity": "charity_law",
  "agricultural": "agricultural_rural",
  "military": "military_law",
  "maritime": "maritime_law",
  "aviation": "aviation_law",
  "sports": "sports_law",
  "fraud": "fraud_financial_crime",
  "financial crime": "fraud_financial_crime",
  "insolvency and restructuring": "insolvency",
  "inquests": "inquests_coroners",
  "coroners and inquests": "inquests_coroners",
  "probate and estate administration": "wills_probate",
  "property - commercial": "commercial_property",
  "property - residential": "conveyancing",
  conveyancing: "conveyancing",
  "residential conveyancing": "conveyancing",
  "commercial conveyancing": "conveyancing",
  "property conveyancing": "conveyancing",
  "public law": "public_law",
  "tax": "tax_law",
  "banking and finance": "banking_finance",
  "welfare benefits": "welfare_benefits",
  "wills, trusts and tax planning": "wills_probate",
  "wills trusts and probate": "wills_probate",
};

export type SraWorkAreaMapping = {
  slugs: string[];
  practiceAreas: string[];
  relatedPracticeAreas: string[];
  taxonomyAliases: string[];
  confidence: number;
  matchedLabels: string[];
};

function normalizeWorkAreaLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when a line matches a known SRA register WorkArea label (exact or normalised). */
export function isKnownSraWorkAreaLabel(label: string): boolean {
  const normalized = normalizeWorkAreaLabel(label);
  if (!normalized) return false;
  if (normalized in SRA_WORK_AREA_EXACT) return true;
  return normalizePracticeAreas(label).canonicalSlugs.length > 0;
}

function aliasesForSlug(slug: string): string[] {
  const entry = bySlug.get(slug);
  if (!entry) return [];
  return [...entry.aliases, ...entry.userPhrases.slice(0, 4)];
}

/**
 * Map SRA register `WorkArea` strings to canonical taxonomy slugs.
 */
export function mapSraWorkAreasToTaxonomy(workAreas: string[]): SraWorkAreaMapping {
  const slugSet = new Set<string>();
  const matchedLabels: string[] = [];
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const rawLabel of workAreas) {
    const label = rawLabel.trim();
    if (!label) continue;

    const exactSlug = SRA_WORK_AREA_EXACT[normalizeWorkAreaLabel(label)];
    if (exactSlug) {
      slugSet.add(exactSlug);
      matchedLabels.push(label);
      confidenceSum += 0.95;
      confidenceCount++;
      continue;
    }

    const normalized = normalizePracticeAreas(label);
    for (const slug of normalized.canonicalSlugs) {
      slugSet.add(slug);
      matchedLabels.push(label);
    }
    if (normalized.canonicalSlugs.length > 0) {
      confidenceSum += normalized.taxonomyConfidence || 0.85;
      confidenceCount++;
    }
  }

  const slugs = [...slugSet].sort((a, b) => a.localeCompare(b));
  const practiceAreas = slugs.map((slug) => slugLabel(slug));
  const relatedPracticeAreas = slugs.flatMap((slug) => bySlug.get(slug)?.relatedPracticeAreas ?? []);
  const taxonomyAliases = slugs.flatMap((slug) => aliasesForSlug(slug));

  return {
    slugs,
    practiceAreas: [...new Set(practiceAreas)],
    relatedPracticeAreas: [...new Set(relatedPracticeAreas)],
    taxonomyAliases: [...new Set(taxonomyAliases)],
    confidence: confidenceCount ? Math.min(1, confidenceSum / confidenceCount) : 0,
    matchedLabels: [...new Set(matchedLabels)],
  };
}

/** Parse `work_area` JSON column from Postgres into string labels. */
export function parseSraWorkAreaField(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
    else if (item && typeof item === "object") {
      const name = (item as { Name?: string; name?: string }).Name ?? (item as { name?: string }).name;
      if (typeof name === "string" && name.trim()) out.push(name.trim());
    }
  }
  return out;
}

/**
 * Apply authoritative SRA WorkArea slug mapping onto a legal-entity index document.
 */
export function applySraWorkAreaSlugsToDocument(
  doc: LegalEntityDocument,
  workAreas: string[],
): LegalEntityDocument {
  if (workAreas.length === 0) return doc;

  const mapped = mapSraWorkAreasToTaxonomy(workAreas);
  if (mapped.slugs.length === 0) return doc;

  doc.practiceAreaSlugs = [...(doc.practiceAreaSlugs ?? [])];
  doc.practiceAreas = [...(doc.practiceAreas ?? [])];
  doc.relatedPracticeAreas = [...(doc.relatedPracticeAreas ?? [])];
  doc.taxonomyAliases = [...(doc.taxonomyAliases ?? [])];
  doc.taxonomyProjectionMatches = [...(doc.taxonomyProjectionMatches ?? [])];

  for (const slug of mapped.slugs) {
    if (!doc.practiceAreaSlugs.includes(slug)) doc.practiceAreaSlugs.push(slug);
    const name = slugLabel(slug);
    if (!doc.practiceAreas.includes(name)) doc.practiceAreas.push(name);
    const reason = `sra_work_area:${slug}`;
    if (!doc.taxonomyProjectionMatches.includes(reason)) {
      doc.taxonomyProjectionMatches.push(reason);
    }
  }

  for (const name of mapped.relatedPracticeAreas) {
    if (!doc.relatedPracticeAreas.includes(name)) doc.relatedPracticeAreas.push(name);
  }

  for (const alias of mapped.taxonomyAliases) {
    if (!doc.taxonomyAliases.includes(alias)) doc.taxonomyAliases.push(alias);
  }

  doc.sraProjectionConfidence = Math.max(doc.sraProjectionConfidence ?? 0, mapped.confidence);

  const aliasExtra = [...mapped.practiceAreas, ...mapped.taxonomyAliases].join(" ");
  if (aliasExtra.trim()) {
    doc.expandedSearchText = `${doc.expandedSearchText ?? ""} ${aliasExtra}`.trim().slice(0, 1200);
  }

  return doc;
}
