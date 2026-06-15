import {
  LEGAL_ISSUE_TAXONOMY,
  type LegalIssueTaxonomyEntry,
} from "@/lib/legal/legal-issue-taxonomy-data";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { extractCapabilities } from "@/lib/provider-intelligence/capability-extractor";
import type { ProviderCapability } from "@/lib/provider-intelligence/capability-taxonomy";
import type { LegalEntityDocument } from "@/lib/search-index/types";

export type SraPracticeAreaProjectionInput = {
  organisationName: string;
  descriptionText?: string;
  serviceText?: string;
  websiteText?: string;
  /** Enrichment / capability text (weighted higher in matching). */
  enrichmentText?: string;
  practiceKeywords?: string[];
  city?: string;
  /** Optional extra text (e.g. semantic taxonomy hints). */
  semanticHints?: string[];
  /** Approved enrichment capability slugs (e.g. tribunal.employment). */
  approvedCapabilities?: string[];
  enrichmentApproved?: boolean;
};

export type SraPracticeAreaProjection = {
  practiceAreaSlugs: string[];
  relatedPracticeAreas: string[];
  taxonomyAliases: string[];
  confidence: number;
  /** Employment slug confidence when employment signals are present (0–1). */
  employmentProjectionConfidence?: number;
  matchedSignals: string[];
};

type SignalStrength = "strong" | "medium" | "weak";

type AreaSignal = {
  slug: string;
  pattern: RegExp;
  strength: SignalStrength;
  label: string;
};

const bySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));

const STRENGTH_WEIGHT: Record<SignalStrength, number> = {
  strong: 3,
  medium: 2,
  weak: 1,
};

const MAX_PRIMARY_SLUGS = 3;
const MIN_STRONG_FOR_PRIMARY = 3;
const MIN_MEDIUM_PAIR_FOR_PRIMARY = 4;
/** Relaxed primary threshold for employment when corroborated signals exist. */
const MIN_EMPLOYMENT_RELAXED_PRIMARY = 2;

const EMPLOYMENT_SLUG = "employment";

const DEBUG_EMPLOYMENT_PROJECTION =
  process.env.DEBUG_SRA_EMPLOYMENT_PROJECTION === "1" ||
  process.env.DEBUG_SRA_EMPLOYMENT_PROJECTION === "true";

const DEBUG_EMPLOYMENT_PHRASES = [
  "employment law",
  "unfair dismissal",
  "redundancy",
  "employment tribunal",
  "workplace discrimination",
  "constructive dismissal",
  "TUPE",
] as const;

const GENERIC_COMMERCIAL_PATTERN =
  /\b(commercial litigation|commercial law|business law|corporate law|corporate litigation|company law|banking disputes?)\b/i;

const CAPABILITY_TO_SLUG: Partial<
  Record<ProviderCapability, { slug: string; strength: SignalStrength }>
> = {
  "tribunal.family_court": { slug: "family", strength: "strong" },
  "client.children_families": { slug: "family", strength: "medium" },
  "support.domestic_abuse": { slug: "family", strength: "strong" },
  "representation.mediation": { slug: "family", strength: "weak" },
  "tribunal.employment": { slug: "employment", strength: "strong" },
  "tribunal.immigration": { slug: "immigration", strength: "strong" },
  "support.refugee_asylum": { slug: "immigration", strength: "medium" },
  "tribunal.send": { slug: "education", strength: "strong" },
  "support.prison": { slug: "prison_law", strength: "strong" },
  "tribunal.parole_board": { slug: "prison_law", strength: "strong" },
  "tribunal.crown_court": { slug: "criminal_defence", strength: "medium" },
  "tribunal.magistrates": { slug: "criminal_defence", strength: "medium" },
};

const AREA_SIGNALS: AreaSignal[] = [
  // Family / divorce
  { slug: "family", pattern: /\bdivorce\b/i, strength: "strong", label: "divorce" },
  { slug: "family", pattern: /\bfamily law\b/i, strength: "strong", label: "family law" },
  { slug: "family", pattern: /\bchild arrangements?\b/i, strength: "strong", label: "child arrangements" },
  { slug: "family", pattern: /\bchildren disputes?\b/i, strength: "strong", label: "children disputes" },
  { slug: "family", pattern: /\bchild custody\b/i, strength: "strong", label: "child custody" },
  { slug: "family", pattern: /\bdomestic abuse\b/i, strength: "strong", label: "domestic abuse" },
  { slug: "family", pattern: /\bdomestic violence\b/i, strength: "strong", label: "domestic violence" },
  { slug: "family", pattern: /\bmatrimonial\b/i, strength: "strong", label: "matrimonial" },
  { slug: "family", pattern: /\bfinancial remedy\b/i, strength: "strong", label: "financial remedy" },
  { slug: "family", pattern: /\bseparation\b/i, strength: "medium", label: "separation" },
  { slug: "family", pattern: /\bcohabitation\b/i, strength: "medium", label: "cohabitation" },
  { slug: "family", pattern: /\binjunction\b/i, strength: "medium", label: "injunction" },
  { slug: "family", pattern: /\bfamily mediation\b/i, strength: "medium", label: "family mediation" },
  { slug: "family", pattern: /\bparental responsibility\b/i, strength: "medium", label: "parental responsibility" },
  { slug: "family", pattern: /\bfamily solicitor\b/i, strength: "medium", label: "family solicitor" },
  { slug: "family", pattern: /\bfamily department\b/i, strength: "medium", label: "family department" },
  { slug: "family", pattern: /\bchildren act\b/i, strength: "medium", label: "children act" },
  { slug: "family", pattern: /\bfamily\b/i, strength: "weak", label: "family" },
  // Education
  { slug: "education", pattern: /\bsend tribunal\b/i, strength: "strong", label: "SEND tribunal" },
  { slug: "education", pattern: /\bschool exclusion\b/i, strength: "strong", label: "school exclusion" },
  { slug: "education", pattern: /\bspecial educational needs\b/i, strength: "medium", label: "SEN" },
  { slug: "education", pattern: /\beducation law\b/i, strength: "medium", label: "education law" },
  // Housing
  { slug: "housing", pattern: /\blandlord\b/i, strength: "medium", label: "landlord" },
  { slug: "housing", pattern: /\beviction\b/i, strength: "strong", label: "eviction" },
  { slug: "housing", pattern: /\bsection 21\b/i, strength: "strong", label: "section 21" },
  { slug: "housing", pattern: /\bhousing disrepair\b/i, strength: "medium", label: "housing disrepair" },
  { slug: "housing", pattern: /\btenant\b/i, strength: "weak", label: "tenant" },
  // Employment (specific phrases only — no generic commercial/business)
  { slug: EMPLOYMENT_SLUG, pattern: /\bemployment law\b/i, strength: "strong", label: "employment law" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bunfair dismissal\b/i, strength: "strong", label: "unfair dismissal" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bwrongful dismissal\b/i, strength: "strong", label: "wrongful dismissal" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bconstructive dismissal\b/i, strength: "strong", label: "constructive dismissal" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bworkplace discrimination\b/i, strength: "strong", label: "workplace discrimination" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bdiscrimination at work\b/i, strength: "strong", label: "discrimination at work" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bredundancy\b/i, strength: "strong", label: "redundancy" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bsettlement agreement\b/i, strength: "strong", label: "settlement agreement" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bwhistleblowing\b/i, strength: "strong", label: "whistleblowing" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bemployment tribunal\b/i, strength: "strong", label: "employment tribunal" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bTUPE\b/i, strength: "strong", label: "TUPE" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bworkplace harassment\b/i, strength: "strong", label: "workplace harassment" },
  { slug: EMPLOYMENT_SLUG, pattern: /\blabour law\b/i, strength: "strong", label: "labour law" },
  { slug: EMPLOYMENT_SLUG, pattern: /\blabor law\b/i, strength: "strong", label: "labor law" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bemployee dispute\b/i, strength: "medium", label: "employee dispute" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bemployer dispute\b/i, strength: "medium", label: "employer dispute" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bHR dispute\b/i, strength: "medium", label: "HR dispute" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bwage dispute\b/i, strength: "medium", label: "wage dispute" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bworkplace dispute\b/i, strength: "medium", label: "workplace dispute" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bemployment solicitor\b/i, strength: "medium", label: "employment solicitor" },
  { slug: EMPLOYMENT_SLUG, pattern: /\bemployment department\b/i, strength: "medium", label: "employment department" },
  /** SRA PracticeAreas / areas-of-law label (authoritative metadata). */
  {
    slug: EMPLOYMENT_SLUG,
    pattern: /\bemployment\b/i,
    strength: "strong",
    label: "employment practice area",
  },
  // Immigration
  { slug: "immigration", pattern: /\basylum\b/i, strength: "strong", label: "asylum" },
  { slug: "immigration", pattern: /\bvisa\b/i, strength: "medium", label: "visa" },
  { slug: "immigration", pattern: /\bdeportation\b/i, strength: "strong", label: "deportation" },
  { slug: "immigration", pattern: /\bimmigration\b/i, strength: "weak", label: "immigration" },
  // Prison
  { slug: "prison_law", pattern: /\bparole\b/i, strength: "strong", label: "parole" },
  { slug: "prison_law", pattern: /\bprison recall\b/i, strength: "strong", label: "prison recall" },
  { slug: "prison_law", pattern: /\blicence recall\b/i, strength: "strong", label: "licence recall" },
  { slug: "prison_law", pattern: /\bprison law\b/i, strength: "strong", label: "prison law" },
  { slug: "prison_law", pattern: /\bprisoner\b/i, strength: "medium", label: "prisoner" },
  // Criminal
  {
    slug: "criminal_defence",
    pattern: /\bpolice station\b/i,
    strength: "strong",
    label: "police station",
  },
  {
    slug: "criminal_defence",
    pattern: /\bcriminal defence\b/i,
    strength: "strong",
    label: "criminal defence",
  },
  {
    slug: "criminal_defence",
    pattern: /\bcriminal law\b/i,
    strength: "medium",
    label: "criminal law",
  },
  {
    slug: "criminal_defence",
    pattern: /\bmotoring offence\b/i,
    strength: "weak",
    label: "motoring",
  },
  // Welfare / PI / commercial (weak guards)
  {
    slug: "welfare_benefits",
    pattern: /\buniversal credit\b/i,
    strength: "strong",
    label: "universal credit",
  },
  {
    slug: "welfare_benefits",
    pattern: /\bbenefits appeal\b/i,
    strength: "medium",
    label: "benefits appeal",
  },
  {
    slug: "personal_injury",
    pattern: /\bpersonal injury\b/i,
    strength: "strong",
    label: "personal injury",
  },
  {
    slug: "personal_injury",
    pattern: /\bclinical negligence\b/i,
    strength: "strong",
    label: "clinical negligence",
  },
];

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

function buildHaystack(input: SraPracticeAreaProjectionInput): string {
  const core = [
    input.organisationName,
    input.descriptionText,
    input.serviceText,
    input.city,
    ...(input.practiceKeywords ?? []),
    ...(input.semanticHints ?? []),
  ]
    .filter(Boolean)
    .join("\n");
  const websiteBoost = input.websiteText ? `${input.websiteText}\n${input.websiteText}` : "";
  const enrichmentBoost = input.enrichmentText
    ? `${input.enrichmentText}\n${input.enrichmentText}`
    : "";
  return [core, websiteBoost, enrichmentBoost].filter(Boolean).join("\n").toLowerCase();
}

function employmentPracticeKeywordHit(keywords: string[] | undefined): boolean {
  if (!keywords?.length) return false;
  return keywords.some((k) => /\bemployment\b/i.test(k));
}

function hasApprovedEmploymentCapability(input: SraPracticeAreaProjectionInput): boolean {
  if (!input.enrichmentApproved || !input.approvedCapabilities?.length) return false;
  return input.approvedCapabilities.some(
    (c) => c === "tribunal.employment" || c.includes("employment"),
  );
}

function employmentMinPrimaryScore(
  employmentPhraseCount: number,
  hasEmploymentTribunal: boolean,
  hasApprovedEmploymentCapability: boolean,
): number {
  if (
    employmentPhraseCount >= 2 ||
    hasEmploymentTribunal ||
    hasApprovedEmploymentCapability
  ) {
    return MIN_EMPLOYMENT_RELAXED_PRIMARY;
  }
  return MIN_STRONG_FOR_PRIMARY;
}

function employmentProjectionConfidenceValue(
  employmentScore: number,
  minPrimary: number,
): number {
  if (employmentScore <= 0) return 0;
  return Math.min(1, Math.round((employmentScore / (minPrimary * 1.2)) * 100) / 100);
}

function scoreSlug(
  slugScores: Map<string, number>,
  slug: string,
  strength: SignalStrength,
  matchedSignals: string[],
  label: string,
): void {
  slugScores.set(slug, (slugScores.get(slug) ?? 0) + STRENGTH_WEIGHT[strength]);
  matchedSignals.push(`${slug}:${label} (${strength})`);
}

function qualifiesForPrimary(
  slug: string,
  slugScores: Map<string, number>,
  employmentContext?: {
    hasEmploymentSpecific: boolean;
    employmentPhraseCount: number;
    hasEmploymentTribunal: boolean;
    hasApprovedEmploymentCapability: boolean;
    genericCommercialOnly: boolean;
  },
): boolean {
  const score = slugScores.get(slug) ?? 0;
  if (slug === EMPLOYMENT_SLUG && employmentContext) {
    if (!employmentContext.hasEmploymentSpecific) return false;
    if (employmentContext.genericCommercialOnly) return false;
    const minPrimary = employmentMinPrimaryScore(
      employmentContext.employmentPhraseCount,
      employmentContext.hasEmploymentTribunal,
      employmentContext.hasApprovedEmploymentCapability,
    );
    if (score >= minPrimary) return true;
    if (score >= MIN_MEDIUM_PAIR_FOR_PRIMARY) return true;
    return false;
  }
  if (score >= MIN_STRONG_FOR_PRIMARY) return true;
  if (score >= MIN_MEDIUM_PAIR_FOR_PRIMARY) return true;
  return false;
}

function aliasesForEntry(entry: LegalIssueTaxonomyEntry, max = 8): string[] {
  return uniqueStrings(
    [...entry.aliases, ...entry.searchBoostTerms.slice(0, 6), entry.canonicalName],
    max,
  );
}

/**
 * Infer practice-area taxonomy from SRA organisation text and capabilities.
 */
export function projectSraPracticeAreas(
  input: SraPracticeAreaProjectionInput,
): SraPracticeAreaProjection {
  const haystack = buildHaystack(input);
  const matchedSignals: string[] = [];
  const slugScores = new Map<string, number>();
  let employmentPhraseCount = 0;
  let hasEmploymentTribunal = false;
  let hasEmploymentSpecific = false;

  for (const sig of AREA_SIGNALS) {
    if (sig.pattern.test(haystack)) {
      scoreSlug(slugScores, sig.slug, sig.strength, matchedSignals, sig.label);
      if (sig.slug === EMPLOYMENT_SLUG) {
        employmentPhraseCount += 1;
        hasEmploymentSpecific = true;
        if (sig.label === "employment tribunal") hasEmploymentTribunal = true;
      }
    }
  }

  if (employmentPracticeKeywordHit(input.practiceKeywords)) {
    hasEmploymentSpecific = true;
    scoreSlug(slugScores, EMPLOYMENT_SLUG, "medium", matchedSignals, "practice_keyword");
  }

  const capabilityBlob = [
    input.descriptionText,
    input.serviceText,
    input.websiteText,
    input.enrichmentText,
    ...(input.practiceKeywords ?? []),
  ]
    .filter(Boolean)
    .join("\n");

  if (capabilityBlob.trim()) {
    const caps = extractCapabilities({
      text: capabilityBlob,
      practiceAreas: input.practiceKeywords,
      source: "sra_description",
    });
    for (const c of caps) {
      const mapped = CAPABILITY_TO_SLUG[c.capability];
      if (!mapped) continue;
      const strength =
        c.confidence >= 0.9 ? mapped.strength : c.confidence >= 0.8 ? mapped.strength : "weak";
      scoreSlug(slugScores, mapped.slug, strength, matchedSignals, c.capability);
      if (mapped.slug === EMPLOYMENT_SLUG) {
        hasEmploymentSpecific = true;
        if (c.capability === "tribunal.employment") hasEmploymentTribunal = true;
      }
    }
  }

  if (hasApprovedEmploymentCapability(input)) {
    hasEmploymentSpecific = true;
    scoreSlug(
      slugScores,
      EMPLOYMENT_SLUG,
      "strong",
      matchedSignals,
      "approved_enrichment:tribunal.employment",
    );
  }

  const resolution = resolveLegalIssueFromQuery(haystack);
  if (resolution && resolution.matchStrength >= 12) {
    const strength: SignalStrength =
      resolution.matchStrength >= 28 ? "strong" : resolution.matchStrength >= 18 ? "medium" : "weak";
    scoreSlug(slugScores, resolution.taxonomySlug, strength, matchedSignals, "taxonomy_resolve");
  }

  if (input.semanticHints?.length) {
    for (const hint of input.semanticHints) {
      const hintResolution = resolveLegalIssueFromQuery(hint);
      if (hintResolution) {
        scoreSlug(slugScores, hintResolution.taxonomySlug, "medium", matchedSignals, "semantic_hint");
      }
    }
  }

  const genericCommercialOnly =
    GENERIC_COMMERCIAL_PATTERN.test(haystack) && !hasEmploymentSpecific;
  const employmentContext = {
    hasEmploymentSpecific,
    employmentPhraseCount,
    hasEmploymentTribunal,
    hasApprovedEmploymentCapability: hasApprovedEmploymentCapability(input),
    genericCommercialOnly,
  };

  const ranked = [...slugScores.entries()].sort((a, b) => b[1] - a[1]);
  const practiceAreaSlugs: string[] = [];
  const relatedPracticeAreas: string[] = [];
  const taxonomyAliases: string[] = [];

  for (const [slug, score] of ranked) {
    const entry = bySlug.get(slug);
    if (!entry) continue;
    if (
      qualifiesForPrimary(slug, slugScores, employmentContext) &&
      practiceAreaSlugs.length < MAX_PRIMARY_SLUGS
    ) {
      practiceAreaSlugs.push(slug);
    } else if (score >= STRENGTH_WEIGHT.medium) {
      if (!relatedPracticeAreas.includes(entry.canonicalName)) {
        relatedPracticeAreas.push(entry.canonicalName);
      }
      taxonomyAliases.push(...aliasesForEntry(entry, 4));
    } else if (score >= STRENGTH_WEIGHT.weak) {
      taxonomyAliases.push(...aliasesForEntry(entry, 3));
    }
  }

  const topScore = ranked[0]?.[1] ?? 0;
  const confidence =
    topScore === 0 ? 0 : Math.min(1, Math.round((topScore / (MIN_STRONG_FOR_PRIMARY * 1.2)) * 100) / 100);

  const employmentScore = slugScores.get(EMPLOYMENT_SLUG) ?? 0;
  const employmentMinPrimary = employmentMinPrimaryScore(
    employmentPhraseCount,
    hasEmploymentTribunal,
    employmentContext.hasApprovedEmploymentCapability,
  );
  const employmentProjectionConfidence = employmentProjectionConfidenceValue(
    employmentScore,
    employmentMinPrimary,
  );

  if (DEBUG_EMPLOYMENT_PROJECTION) {
    const empPhraseHits = DEBUG_EMPLOYMENT_PHRASES.filter((p) => haystack.includes(p));
    const orgId =
      input.descriptionText?.match(/\bsra[:\-]?(\d+)\b/i)?.[1] ??
      input.organisationName.slice(0, 40);
    if (empPhraseHits.length > 0 || employmentScore > 0) {
      console.info(
        JSON.stringify({
          event: "sra_employment_projection_debug",
          orgId,
          organisationName: input.organisationName.slice(0, 80),
          matchedEmploymentPhrases: empPhraseHits,
          employmentPhraseCount,
          hasEmploymentSpecific,
          hasEmploymentTribunal,
          genericCommercialOnly,
          employmentScore,
          employmentMinPrimary,
          qualifiesEmployment: qualifiesForPrimary(
            EMPLOYMENT_SLUG,
            slugScores,
            employmentContext,
          ),
          practiceAreaSlugs,
          confidence,
          employmentProjectionConfidence,
          employmentSignals: matchedSignals.filter((s) => s.startsWith("employment:")),
        }),
      );
    }
  }

  const employmentEntry = bySlug.get(EMPLOYMENT_SLUG);
  if (employmentEntry && (employmentScore > 0 || practiceAreaSlugs.includes(EMPLOYMENT_SLUG))) {
    for (const rel of employmentEntry.relatedPracticeAreas) {
      if (!relatedPracticeAreas.includes(rel)) relatedPracticeAreas.push(rel);
    }
    taxonomyAliases.push(...aliasesForEntry(employmentEntry, 6));
  }

  return {
    practiceAreaSlugs: uniqueStrings(practiceAreaSlugs, MAX_PRIMARY_SLUGS),
    relatedPracticeAreas: uniqueStrings(relatedPracticeAreas, 12),
    taxonomyAliases: uniqueStrings(taxonomyAliases, 20),
    confidence,
    employmentProjectionConfidence:
      employmentProjectionConfidence > 0 ? employmentProjectionConfidence : undefined,
    matchedSignals: uniqueStrings(matchedSignals, 32),
  };
}

/** Merge SRA projection onto a legal-entity index document. */
export function applySraPracticeAreaProjection(
  doc: LegalEntityDocument,
  projection: SraPracticeAreaProjection,
): LegalEntityDocument {
  doc.practiceAreaSlugs = [...(doc.practiceAreaSlugs ?? [])];
  doc.relatedPracticeAreas = [...(doc.relatedPracticeAreas ?? [])];
  doc.taxonomyAliases = [...(doc.taxonomyAliases ?? [])];
  doc.taxonomyProjectionMatches = [...(doc.taxonomyProjectionMatches ?? [])];

  for (const slug of projection.practiceAreaSlugs) {
    const entry = bySlug.get(slug);
    if (!entry) continue;
    if (!doc.practiceAreaSlugs.includes(slug)) doc.practiceAreaSlugs.push(slug);
    if (!doc.practiceAreas.includes(entry.canonicalName)) {
      doc.practiceAreas.push(entry.canonicalName);
    }
    if (!doc.relatedPracticeAreas.includes(entry.canonicalName)) {
      doc.relatedPracticeAreas.push(entry.canonicalName);
    }
    for (const a of aliasesForEntry(entry)) {
      if (!doc.taxonomyAliases.includes(a)) doc.taxonomyAliases.push(a);
    }
    const reason = `sra_projection:${slug}`;
    if (!doc.taxonomyProjectionMatches.includes(reason)) {
      doc.taxonomyProjectionMatches.push(reason);
    }
  }

  for (const name of projection.relatedPracticeAreas) {
    if (!doc.relatedPracticeAreas.includes(name)) doc.relatedPracticeAreas.push(name);
  }

  for (const alias of projection.taxonomyAliases) {
    if (!doc.taxonomyAliases.includes(alias)) doc.taxonomyAliases.push(alias);
  }

  for (const sig of projection.matchedSignals.slice(0, 8)) {
    const reason = `sra_signal:${sig}`;
    if (!doc.taxonomyProjectionMatches.includes(reason)) {
      doc.taxonomyProjectionMatches.push(reason);
    }
  }

  const primaryAliases = projection.practiceAreaSlugs.flatMap((slug) => {
    const entry = bySlug.get(slug);
    return entry ? aliasesForEntry(entry) : [];
  });
  const aliasExtra = [
    ...primaryAliases,
    ...projection.taxonomyAliases,
    ...projection.relatedPracticeAreas,
  ].join(" ");
  if (aliasExtra.trim()) {
    doc.expandedSearchText = `${doc.expandedSearchText} ${aliasExtra}`.trim().slice(0, 1200);
  }

  doc.practiceAreas = uniqueStrings(doc.practiceAreas, 16);
  doc.practiceAreaSlugs = uniqueStrings(doc.practiceAreaSlugs, 12);
  doc.relatedPracticeAreas = uniqueStrings(doc.relatedPracticeAreas, 16);
  doc.taxonomyAliases = uniqueStrings(doc.taxonomyAliases, 24);
  doc.taxonomyProjectionMatches = uniqueStrings(doc.taxonomyProjectionMatches, 24);
  doc.sraProjectionConfidence = projection.confidence;
  if (
    projection.employmentProjectionConfidence != null &&
    projection.practiceAreaSlugs.includes(EMPLOYMENT_SLUG)
  ) {
    doc.employmentProjectionConfidence = projection.employmentProjectionConfidence;
  }

  return doc;
}

/** Project from a built SRA document (includes enrichment fields when present). */
export function projectAndApplySraPracticeAreas(doc: LegalEntityDocument): LegalEntityDocument {
  const enrichmentApproved =
    doc.enrichmentStatus === "approved" || doc.enrichmentStatus === "auto_approved";
  // Use only structured enrichment/capabilities — not expandedSearchText (contains projected
  // taxonomy aliases and causes feedback loops on re-projection during indexing).
  const enrichmentText = [doc.capabilities?.join(" "), doc.tribunalCapabilities?.join(" ")]
    .filter(Boolean)
    .join("\n");
  const projection = projectSraPracticeAreas({
    organisationName: doc.title,
    descriptionText: doc.searchText,
    serviceText: doc.description,
    websiteText: doc.website,
    enrichmentText: enrichmentText || undefined,
    practiceKeywords: doc.practiceAreas,
    city: doc.city,
    approvedCapabilities: enrichmentApproved ? doc.capabilities : undefined,
    enrichmentApproved,
  });
  return applySraPracticeAreaProjection(doc, projection);
}
