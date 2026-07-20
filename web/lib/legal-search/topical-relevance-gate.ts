import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";

type TopicalGateInfo = {
  topicalGatePassed: boolean;
  topicalGateReason: string;
  primaryTaxonomyMatch: boolean;
  overlapReason?: string;
  suppressedPracticeAreaReason?: string;
};

export type TopicalGateDebug = {
  topicalGateApplied: boolean;
  topicalGateMode: "strict" | "soft" | "off";
  primaryTaxonomySlug?: string;
  allowedOverlapSlugs?: string[];
  suppressedSlugs?: string[];
  resultsRemovedByTopicalGate: number;
  rescueBeforeGateCount?: number;
  rescueAfterGateCount?: number;
};

type GateProfile = {
  positiveTerms: string[];
  capabilityTerms: string[];
  tribunalTerms: string[];
  suppressedSlugs: string[];
  overlapSlugs: string[];
};

const bySlug = new Map(LEGAL_ISSUE_TAXONOMY.map((e) => [e.slug, e]));
const slugAliasToCanonical = new Map<string, string>([
  ["probate", "wills_probate"],
  ["wills_probate", "wills_probate"],
  ["neighbour_dispute", "neighbour_dispute"],
]);

type QueryContextRule = {
  id: string;
  queryPatterns: RegExp[];
  primarySlugs: string[];
  allowSlugs: string[];
};

/** Cross-area queries: allow related practice slugs when query + result text both align. */
const QUERY_CONTEXT_RULES: QueryContextRule[] = [
  {
    id: "domestic_abuse",
    queryPatterns: [
      /\b(domestic abuse|domestic violence|non[- ]?molestation|occupation order|injunction against)\b/i,
    ],
    primarySlugs: ["family"],
    allowSlugs: ["criminal_defence", "public_law"],
  },
  {
    id: "immigration_detention",
    queryPatterns: [/\b(immigration detention|detained|removal centre|detention centre)\b/i],
    primarySlugs: ["immigration"],
    allowSlugs: ["prison_law", "public_law", "criminal_defence"],
  },
  {
    id: "trafficking",
    queryPatterns: [/\b(trafficking|modern slavery|labour exploitation|forced labour)\b/i],
    primarySlugs: ["immigration", "employment", "public_law"],
    allowSlugs: ["immigration", "employment", "public_law"],
  },
  {
    id: "first_time_buyer_conveyancing",
    queryPatterns: [
      /\b(first[- ]?time buyer|ftb|buying my first home|buying a house|property purchase|conveyancing)\b/i,
    ],
    primarySlugs: ["conveyancing"],
    allowSlugs: ["housing", "wills_probate"],
  },
  {
    id: "housing_disrepair_injury",
    queryPatterns: [/\b(disrepair.{0,40}(injur|ill)|housing.{0,30}injur|damp|mould.{0,20}health)\b/i],
    primarySlugs: ["housing"],
    allowSlugs: ["personal_injury", "clinical_negligence"],
  },
  {
    id: "child_protection",
    queryPatterns: [/\b(child protection|care proceedings|social services.{0,20}child)\b/i],
    primarySlugs: ["family"],
    allowSlugs: ["public_law", "criminal_defence"],
  },
  {
    id: "police_misconduct",
    queryPatterns: [/\b(police misconduct|unlawful arrest|malicious prosecution|misfeasance)\b/i],
    primarySlugs: ["criminal_defence", "public_law"],
    allowSlugs: ["criminal_defence", "public_law"],
  },
  {
    id: "homelessness_immigration",
    queryPatterns: [/\b(no recourse|nrpf|homeless.{0,30}asylum|housing.{0,30}immigration)\b/i],
    primarySlugs: ["housing", "immigration"],
    allowSlugs: ["immigration", "housing", "welfare_benefits", "public_law"],
  },
  {
    id: "neighbour_threats",
    queryPatterns: [/\b(neighbour.{0,30}(threat|assault|violence|harass)|asb.{0,20}threat)\b/i],
    primarySlugs: ["neighbour_dispute", "housing"],
    allowSlugs: ["criminal_defence", "family", "housing"],
  },
];

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

function uniq(items: string[]): string[] {
  return [...new Set(items.map(normalise).filter((x) => x.length > 2))];
}

function slugTerm(slug: string): string {
  return slug.replace(/_/g, " ");
}

function textFromResult(r: SearchResult): string {
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
  return [
    r.title,
    r.description ?? "",
    ...r.practiceAreas,
    ...r.categories,
    ...arr(raw.practiceAreaSlugs),
    ...arr(raw.relatedPracticeAreas),
    ...arr(raw.taxonomyAliases),
    ...arr(raw.legalTerms),
    ...arr(raw.userPhrases),
    String(raw.searchText ?? ""),
  ]
    .join(" ")
    .toLowerCase();
}

function rawSlugs(r: SearchResult): string[] {
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(raw.practiceAreaSlugs)) return [];
  return (raw.practiceAreaSlugs as unknown[]).map((x) => String(x).toLowerCase());
}

function rawAliases(r: SearchResult): string[] {
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(raw.taxonomyAliases)) return [];
  return (raw.taxonomyAliases as unknown[]).map((x) => String(x).toLowerCase());
}

function hasCapabilitySignal(r: SearchResult, terms: string[]): boolean {
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const caps = [
    ...(Array.isArray(raw.capabilities) ? (raw.capabilities as string[]) : []),
    ...(Array.isArray(raw.tribunalCapabilities) ? (raw.tribunalCapabilities as string[]) : []),
    ...(Array.isArray(raw.urgencyCapabilities) ? (raw.urgencyCapabilities as string[]) : []),
  ].map((x) => normalise(String(x)));
  return terms.some((t) => caps.some((c) => c.includes(t) || t.includes(c)));
}

function profileForSlug(slug: string): GateProfile {
  const canonical = slugAliasToCanonical.get(slug) ?? slug;
  const entry = bySlug.get(canonical);
  const baseTerms = entry
    ? uniq([
        entry.canonicalName,
        slugTerm(canonical),
        ...entry.aliases,
        ...entry.userPhrases,
        ...entry.subIssues,
        ...entry.searchBoostTerms,
      ])
    : uniq([slugTerm(canonical)]);

  const map: Record<string, Omit<GateProfile, "positiveTerms"> & { extraTerms?: string[] }> = {
    employment: {
      extraTerms: ["employment tribunal", "settlement agreement", "unfair dismissal", "redundancy", "acas"],
      capabilityTerms: ["employment", "tribunal", "workplace", "dismissal", "redundancy"],
      tribunalTerms: ["employment tribunal", "tribunal"],
      suppressedSlugs: ["criminal_defence", "prison_law", "family", "immigration"],
      overlapSlugs: ["public_law", "immigration", "personal_injury"],
    },
    family: {
      extraTerms: ["divorce", "child arrangements", "contact order", "financial remedy", "injunction"],
      capabilityTerms: ["family", "children", "divorce", "domestic abuse", "injunction"],
      tribunalTerms: ["family court", "care proceedings"],
      suppressedSlugs: ["criminal_defence", "prison_law", "employment"],
      overlapSlugs: ["public_law", "criminal_defence"],
    },
    housing: {
      extraTerms: ["eviction", "homelessness", "disrepair", "landlord", "possession order"],
      capabilityTerms: ["housing", "eviction", "homelessness", "disrepair", "landlord", "tenant"],
      tribunalTerms: ["possession", "housing tribunal"],
      suppressedSlugs: ["employment", "immigration", "personal_injury"],
      overlapSlugs: ["immigration", "personal_injury", "public_law", "community_care", "neighbour_dispute"],
    },
    conveyancing: {
      extraTerms: [
        "conveyancing",
        "conveyancer",
        "property purchase",
        "first time buyer",
        "remortgage",
        "leasehold",
        "transfer of equity",
      ],
      capabilityTerms: ["conveyancing", "conveyancer", "property", "residential", "purchase", "sale"],
      tribunalTerms: [],
      suppressedSlugs: ["employment", "immigration", "criminal_defence", "clinical_negligence"],
      overlapSlugs: ["housing", "wills_probate", "commercial_property"],
    },
    immigration: {
      extraTerms: ["visa", "asylum", "deportation", "leave to remain", "detention"],
      capabilityTerms: ["immigration", "visa", "asylum", "deportation", "detention"],
      tribunalTerms: ["immigration tribunal"],
      suppressedSlugs: ["family", "employment", "criminal_defence"],
      overlapSlugs: ["prison_law", "public_law", "family"],
    },
    prison_law: {
      extraTerms: ["parole", "prison recall", "hmp", "licence conditions", "adjudication"],
      capabilityTerms: ["prison", "parole", "recall", "licence", "hmp"],
      tribunalTerms: ["parole board"],
      suppressedSlugs: ["family", "employment", "consumer"],
      overlapSlugs: ["criminal_defence", "immigration", "public_law"],
    },
    criminal_defence: {
      extraTerms: ["arrested", "police station", "bail", "charge", "crown court"],
      capabilityTerms: ["criminal", "police", "bail", "defence", "investigation"],
      tribunalTerms: ["magistrates", "crown court"],
      suppressedSlugs: ["employment", "consumer", "probate"],
      overlapSlugs: ["prison_law", "public_law", "family"],
    },
    welfare_benefits: {
      extraTerms: ["pip", "universal credit", "mandatory reconsideration", "benefits tribunal"],
      capabilityTerms: ["benefits", "pip", "universal credit", "esa", "dla"],
      tribunalTerms: ["benefits tribunal", "social security"],
      suppressedSlugs: ["criminal_defence", "clinical_negligence"],
      overlapSlugs: ["debt", "housing", "community_care"],
    },
    debt: {
      extraTerms: ["ccj", "bailiffs", "iva", "bankruptcy", "arrears"],
      capabilityTerms: ["debt", "ccj", "bailiff", "insolvency", "creditor"],
      tribunalTerms: ["county court"],
      suppressedSlugs: ["family", "criminal_defence", "clinical_negligence"],
      overlapSlugs: ["welfare_benefits", "housing", "consumer"],
    },
    personal_injury: {
      extraTerms: ["accident", "compensation", "rta", "employers liability", "public liability"],
      capabilityTerms: ["injury", "accident", "compensation", "liability"],
      tribunalTerms: ["civil claim"],
      suppressedSlugs: ["criminal_defence", "immigration", "probate"],
      overlapSlugs: ["clinical_negligence", "housing", "employment"],
    },
    clinical_negligence: {
      extraTerms: ["doctor made a mistake", "medical negligence", "misdiagnosis", "surgical error"],
      capabilityTerms: ["clinical negligence", "medical negligence", "nhs", "misdiagnosis"],
      tribunalTerms: ["inquest"],
      suppressedSlugs: ["criminal_defence", "immigration", "debt"],
      overlapSlugs: ["personal_injury", "public_law"],
    },
    education: {
      extraTerms: ["child excluded from school", "ehcp", "send", "school exclusion"],
      capabilityTerms: ["education", "school", "ehcp", "send", "exclusion"],
      tribunalTerms: ["sendist", "education tribunal"],
      suppressedSlugs: ["prison_law", "criminal_defence", "debt"],
      overlapSlugs: ["public_law", "family"],
    },
    community_care: {
      extraTerms: ["care assessment", "chc", "care package", "social services"],
      capabilityTerms: ["community care", "care act", "social care", "chc"],
      tribunalTerms: ["care appeal"],
      suppressedSlugs: ["criminal_defence", "consumer"],
      overlapSlugs: ["housing", "welfare_benefits", "public_law"],
    },
    wills_probate: {
      extraTerms: ["probate", "executor", "will writing", "inheritance dispute", "lpa"],
      capabilityTerms: ["wills", "probate", "executor", "inheritance", "lpa"],
      tribunalTerms: ["probate registry"],
      suppressedSlugs: ["criminal_defence", "immigration", "housing"],
      overlapSlugs: ["public_law", "consumer"],
    },
    public_law: {
      extraTerms: ["judicial review", "public authority", "unlawful decision", "human rights"],
      capabilityTerms: ["public law", "judicial review", "human rights", "jr"],
      tribunalTerms: ["administrative court", "tribunal"],
      suppressedSlugs: ["debt", "consumer", "probate"],
      overlapSlugs: ["immigration", "housing", "family", "prison_law", "education", "community_care"],
    },
    consumer: {
      extraTerms: ["consumer rights", "faulty goods", "refund", "ombudsman"],
      capabilityTerms: ["consumer", "refund", "faulty goods", "small claims"],
      tribunalTerms: ["small claims"],
      suppressedSlugs: ["criminal_defence", "prison_law", "immigration"],
      overlapSlugs: ["debt", "housing", "public_law"],
    },
    neighbour_dispute: {
      extraTerms: ["neighbour", "boundary dispute", "noise nuisance", "anti-social behaviour", "harassment"],
      capabilityTerms: ["neighbour", "boundary", "nuisance", "asb", "harassment"],
      tribunalTerms: ["injunction", "civil claim"],
      suppressedSlugs: ["employment", "clinical_negligence", "probate"],
      overlapSlugs: ["housing", "family", "criminal_defence"],
    },
  };

  const row = map[canonical] ?? {
    capabilityTerms: [slugTerm(canonical)],
    tribunalTerms: [],
    suppressedSlugs: [],
    overlapSlugs: [],
  };
  return {
    positiveTerms: uniq([...baseTerms, ...(row.extraTerms ?? [])]),
    capabilityTerms: uniq(row.capabilityTerms),
    tribunalTerms: uniq(row.tribunalTerms),
    suppressedSlugs: row.suppressedSlugs.map(normalise),
    overlapSlugs: row.overlapSlugs.map(normalise),
  };
}

function trustedExternalStyleResult(r: SearchResult): boolean {
  const title = r.title.toLowerCase();
  const raw = (r.raw ?? {}) as Record<string, unknown>;
  const source = String(raw.source ?? r.source).toLowerCase();
  if (source.includes("law_society") || source.includes("sra_register") || source.includes("govuk")) {
    return true;
  }
  return title.includes("law society") || title.includes("sra register") || title.includes("gov.uk");
}

function annotate(r: SearchResult, info: TopicalGateInfo): SearchResult {
  const raw = ((r.raw ?? {}) as Record<string, unknown>) || {};
  return {
    ...r,
    raw: { ...raw, _topicalGate: info },
  };
}

function strongTextSignal(text: string, terms: string[], mode: "strict" | "soft"): boolean {
  const hits = terms.filter((t) => text.includes(t));
  return hits.length >= (mode === "strict" ? 2 : 1);
}

function queryTextForGate(parsed: ParsedQuery): string {
  return [
    parsed.rawText ?? "",
    parsed.semanticQuery ?? "",
    parsed.expandedSearchText ?? "",
    parsed.legalIssue ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function queryContextOverlap(
  query: string,
  primarySlug: string,
  resultSlugs: string[],
  text: string,
): { ok: boolean; overlapReason?: string } {
  for (const rule of QUERY_CONTEXT_RULES) {
    if (!rule.primarySlugs.includes(primarySlug)) continue;
    if (!rule.queryPatterns.some((p) => p.test(query))) continue;
    const hit = resultSlugs.find((s) => rule.allowSlugs.includes(s));
    if (!hit) continue;
    const overlapProfile = profileForSlug(hit);
    const hasQueryPrimary = rule.queryPatterns.some((p) => p.test(query));
    const hasResultOverlap = strongTextSignal(text, overlapProfile.positiveTerms, "soft");
    const hasResultPrimary = strongTextSignal(text, profileForSlug(primarySlug).positiveTerms, "soft");
    if (hasQueryPrimary && (hasResultOverlap || hasResultPrimary || resultSlugs.includes(primarySlug))) {
      return { ok: true, overlapReason: `query_overlap:${rule.id}:${hit}` };
    }
  }
  return { ok: false };
}

function overlapAllowed(
  resultSlugs: string[],
  primaryProfile: GateProfile,
  primarySlug: string,
  mode: "strict" | "soft",
  text: string,
  query: string,
): { ok: boolean; overlapReason?: string } {
  const fromQuery = queryContextOverlap(query, primarySlug, resultSlugs, text);
  if (fromQuery.ok) return fromQuery;

  if (mode === "strict") return { ok: false };
  const overlap = resultSlugs.find((s) => primaryProfile.overlapSlugs.includes(s));
  if (!overlap) return { ok: false };
  const overlapProfile = profileForSlug(overlap);
  const hasPrimary = strongTextSignal(text, primaryProfile.positiveTerms, "soft");
  const hasOverlap = strongTextSignal(text, overlapProfile.positiveTerms, "soft");
  if (hasPrimary && hasOverlap) {
    return { ok: true, overlapReason: `allowed_overlap:${overlap}` };
  }
  return { ok: false };
}

function resolveTopicalGateMode(
  confidence: ParsedQuery["queryConfidence"],
  slug: string,
  query: string,
  parsed: ParsedQuery,
): "strict" | "soft" | "off" {
  const base: "strict" | "soft" | "off" =
    confidence === "high" ? "strict" : confidence === "medium" ? "soft" : "off";
  if (base === "off") return "off";

  const housingEmergency =
    slug === "housing" &&
    /\b(landlord|evict|kicking me out|homeless|bailiff|possession|section 21)\b/i.test(query);
  if (housingEmergency && base === "strict") return "soft";

  if (parsed.urgency === "high" && base === "strict") return "soft";

  return base;
}

export function applyTopicalRelevanceGate(
  results: SearchResult[],
  parsed: ParsedQuery,
  opts?: { rescueBeforeGateCount?: number },
): { results: SearchResult[]; debug: TopicalGateDebug } {
  const originalSlug = parsed.taxonomySlug?.trim().toLowerCase();
  const slug = originalSlug ? slugAliasToCanonical.get(originalSlug) ?? originalSlug : undefined;
  const query = queryTextForGate(parsed);
  const mode = resolveTopicalGateMode(parsed.queryConfidence, slug ?? "", query, parsed);
  if (!slug || mode === "off") {
    return {
      results,
      debug: {
        topicalGateApplied: false,
        topicalGateMode: "off",
        primaryTaxonomySlug: slug,
        allowedOverlapSlugs: [],
        suppressedSlugs: [],
        resultsRemovedByTopicalGate: 0,
        rescueBeforeGateCount: opts?.rescueBeforeGateCount,
        rescueAfterGateCount: opts?.rescueBeforeGateCount,
      },
    };
  }

  const profile = profileForSlug(slug);
  if (profile.positiveTerms.length === 0) {
    return {
      results,
      debug: {
        topicalGateApplied: false,
        topicalGateMode: "off",
        primaryTaxonomySlug: slug,
        allowedOverlapSlugs: [],
        suppressedSlugs: [],
        resultsRemovedByTopicalGate: 0,
        rescueBeforeGateCount: opts?.rescueBeforeGateCount,
        rescueAfterGateCount: opts?.rescueBeforeGateCount,
      },
    };
  }
  const filtered: SearchResult[] = [];

  for (const r of results) {
    if (trustedExternalStyleResult(r)) {
      filtered.push(
        annotate(r, {
          topicalGatePassed: true,
          topicalGateReason: "trusted_external_fallback",
          primaryTaxonomyMatch: false,
        }),
      );
      continue;
    }

    const text = textFromResult(r);
    const slugs = rawSlugs(r);
    const aliases = rawAliases(r);
    const primaryMatch = slugs.includes(slug);
    const relatedMatch = (parsed.taxonomyRelatedLabels ?? [])
      .map(normalise)
      .some((label) => text.includes(label));
    const aliasMatch = profile.positiveTerms.some((t) => aliases.some((a) => a.includes(t) || t.includes(a)));
    const strongTextMatch = strongTextSignal(text, [...profile.positiveTerms, ...profile.tribunalTerms], mode);
    const capabilityMatch = hasCapabilitySignal(
      r,
      [...profile.capabilityTerms, ...profile.positiveTerms, ...profile.tribunalTerms],
    );
    const overlap = overlapAllowed(slugs, profile, slug, mode, text, query);

    let suppressedPracticeAreaReason: string | undefined;
    const negatives = slugs.filter((s) => profile.suppressedSlugs.includes(s));
    if (negatives.length > 0 && !(primaryMatch || aliasMatch || strongTextMatch || capabilityMatch || overlap.ok)) {
      suppressedPracticeAreaReason = `suppressed:${negatives.join(",")}`;
    }

    const passed =
      primaryMatch ||
      relatedMatch ||
      aliasMatch ||
      strongTextMatch ||
      capabilityMatch ||
      overlap.ok;

    if (!passed || suppressedPracticeAreaReason) {
      continue;
    }

    const reason = primaryMatch
      ? "primary_taxonomy_slug"
      : aliasMatch
        ? "taxonomy_alias_match"
        : capabilityMatch
          ? "capability_match"
          : relatedMatch
            ? "related_practice_match"
            : overlap.ok
              ? "allowed_overlap"
              : "strong_textual_match";

    filtered.push(
      annotate(r, {
        topicalGatePassed: true,
        topicalGateReason: reason,
        primaryTaxonomyMatch: primaryMatch,
        overlapReason: overlap.overlapReason,
        suppressedPracticeAreaReason,
      }),
    );
  }

  return {
    results: filtered,
    debug: {
      topicalGateApplied: true,
      topicalGateMode: mode,
      primaryTaxonomySlug: slug,
      allowedOverlapSlugs: profile.overlapSlugs,
      suppressedSlugs: profile.suppressedSlugs,
      resultsRemovedByTopicalGate: Math.max(0, results.length - filtered.length),
      rescueBeforeGateCount: opts?.rescueBeforeGateCount,
      rescueAfterGateCount: filtered.length,
    },
  };
}

