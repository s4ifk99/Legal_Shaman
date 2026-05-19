import {
  LEGAL_ISSUE_TAXONOMY,
  type LegalIssueTaxonomyEntry,
} from "@/lib/legal/legal-issue-taxonomy-data";
import type { LegalEntityDocument } from "@/lib/search-index/types";

/** Text signals that suggest prison-law relevance on an entity profile. */
export const PRISON_TEXT_SIGNALS = [
  "prison",
  "parole",
  "recall",
  "adjudication",
  "hmp",
  "sentence",
  "appeal",
  "custody",
  "inmate",
  "offender",
  "prisoner",
  "licence recall",
] as const;

const bySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));

function uniqueStrings(items: string[], max = 24): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of items) {
    const t = s.trim();
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function haystack(doc: Pick<LegalEntityDocument, "title" | "description" | "searchText" | "practiceAreas" | "categories">): string {
  return [
    doc.title,
    doc.description,
    doc.searchText,
    ...doc.practiceAreas,
    ...doc.categories,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasAnySignal(text: string, signals: readonly string[]): boolean {
  return signals.some((s) => text.includes(s));
}

function practiceAreaMatches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function appendTaxonomy(
  doc: LegalEntityDocument,
  entry: LegalIssueTaxonomyEntry,
  reason: string,
): void {
  doc.taxonomyProjectionMatches = doc.taxonomyProjectionMatches ?? [];
  doc.practiceAreaSlugs = doc.practiceAreaSlugs ?? [];
  doc.relatedPracticeAreas = doc.relatedPracticeAreas ?? [];
  doc.taxonomyAliases = doc.taxonomyAliases ?? [];

  if (!doc.taxonomyProjectionMatches.includes(reason)) {
    doc.taxonomyProjectionMatches.push(reason);
  }

  if (!doc.practiceAreaSlugs.includes(entry.slug)) {
    doc.practiceAreaSlugs.push(entry.slug);
  }

  if (!doc.practiceAreas.includes(entry.canonicalName)) {
    doc.practiceAreas.push(entry.canonicalName);
  }

  if (!doc.relatedPracticeAreas.includes(entry.canonicalName)) {
    doc.relatedPracticeAreas.push(entry.canonicalName);
  }

  for (const a of entry.aliases) {
    if (!doc.taxonomyAliases.includes(a)) doc.taxonomyAliases.push(a);
  }
  for (const t of entry.searchBoostTerms.slice(0, 10)) {
    if (!doc.taxonomyAliases.includes(t)) doc.taxonomyAliases.push(t);
  }

  const extra = uniqueStrings(
    [entry.canonicalName, ...entry.aliases.slice(0, 6), ...entry.searchBoostTerms.slice(0, 8)],
    16,
  ).join(" ");
  if (extra && !doc.expandedSearchText.toLowerCase().includes(entry.canonicalName.toLowerCase())) {
    doc.expandedSearchText = `${doc.expandedSearchText} ${extra}`.trim().slice(0, 1200);
  }
}

/**
 * Enrich index documents with projected taxonomy tags so broad queries (e.g. prison lawyer)
 * match Criminal Defence / Legal Aid entities with prison-related text.
 */
export function applyTaxonomyProjection(doc: LegalEntityDocument): LegalEntityDocument {
  const text = haystack(doc);
  const prisonEntry = bySlug.get("prison_law");
  const criminalEntry = bySlug.get("criminal_defence");
  const humanRightsEntry = LEGAL_ISSUE_TAXONOMY.find((e) =>
    e.canonicalName.toLowerCase().includes("human rights"),
  );

  doc.practiceAreaSlugs = [...(doc.practiceAreaSlugs ?? [])];
  doc.relatedPracticeAreas = [...(doc.relatedPracticeAreas ?? [])];
  doc.taxonomyAliases = [...(doc.taxonomyAliases ?? [])];
  doc.taxonomyProjectionMatches = [...(doc.taxonomyProjectionMatches ?? [])];

  const hasPrisonSignal = hasAnySignal(text, PRISON_TEXT_SIGNALS);
  const isCriminalDefence = practiceAreaMatches(text, /\bcriminal\b|\bdefence\b|\bdefense\b/i);
  const isLegalAidCrime =
    doc.legalAid &&
    practiceAreaMatches(text, /\bcriminal\b|\bcrime\b|\bdefence\b|\bdefense\b|\bprison\b/i);
  const isHumanRights = practiceAreaMatches(text, /\bhuman rights\b/i);
  const isAppeals = practiceAreaMatches(text, /\bappeal(s)?\b/i);

  if (prisonEntry && hasPrisonSignal && isCriminalDefence) {
    appendTaxonomy(doc, prisonEntry, "criminal_defence_prison_text");
  }

  if (prisonEntry && hasPrisonSignal && isLegalAidCrime) {
    appendTaxonomy(doc, prisonEntry, "legal_aid_crime_prison_text");
    if (criminalEntry && !doc.relatedPracticeAreas.includes(criminalEntry.canonicalName)) {
      doc.relatedPracticeAreas.push(criminalEntry.canonicalName);
    }
  }

  if (prisonEntry && hasPrisonSignal && isHumanRights && humanRightsEntry) {
    appendTaxonomy(doc, prisonEntry, "human_rights_prison_text");
  }

  if (prisonEntry && hasPrisonSignal && isAppeals && isCriminalDefence) {
    appendTaxonomy(doc, prisonEntry, "appeals_criminal_prison_text");
    if (!doc.relatedPracticeAreas.includes("Appeals")) {
      doc.relatedPracticeAreas.push("Appeals");
    }
  }

  doc.practiceAreas = uniqueStrings(doc.practiceAreas, 16);
  doc.practiceAreaSlugs = uniqueStrings(doc.practiceAreaSlugs, 12);
  doc.relatedPracticeAreas = uniqueStrings(doc.relatedPracticeAreas, 16);
  doc.taxonomyAliases = uniqueStrings(doc.taxonomyAliases, 24);

  return doc;
}

/** Per-taxonomy broad fallback strings for zero-hit Typesense retry. */
export function taxonomyFallbackQuery(taxonomySlug: string): string {
  const map: Record<string, string> = {
    prison_law: "criminal defence parole prison legal aid appeals",
    criminal_defence: "criminal defence police station bail magistrates legal aid",
    employment: "employment law unfair dismissal discrimination redundancy tribunal",
    immigration: "immigration visa asylum deportation legal aid",
    family: "family law divorce children arrangements legal aid",
    housing: "housing eviction landlord tenant disrepair legal aid possession",
    welfare_benefits: "legal aid benefits tribunal PIP universal credit",
  };
  return map[taxonomySlug] ?? "";
}
