import {
  ACCESSIBILITY_CAPABILITY_PATTERNS,
} from "@/lib/provider-intelligence/accessibility-capabilities";
import type { ProviderCapability } from "@/lib/provider-intelligence/capability-taxonomy";
import { normaliseCapabilities, languageSlugToCapability } from "@/lib/provider-intelligence/capability-normaliser";
import { FUNDING_CAPABILITY_PATTERNS } from "@/lib/provider-intelligence/funding-capabilities";
import { URGENCY_CAPABILITY_PATTERNS } from "@/lib/provider-intelligence/urgency-capabilities";

export type CapabilityExtractionSource =
  | "profile_description"
  | "practice_areas"
  | "legal_aid_categories"
  | "curated_metadata"
  | "sra_description"
  | "manual_tags"
  | "website_page"
  | "law_society_page"
  | "external_directory";

export type ExtractedCapability = {
  capability: ProviderCapability;
  confidence: number;
  source: CapabilityExtractionSource;
  evidence?: string;
};

const REPRESENTATION_PATTERNS: { capability: ProviderCapability; pattern: RegExp }[] = [
  { capability: "representation.litigation", pattern: /\b(litigation|court proceedings|issue proceedings)\b/i },
  { capability: "representation.mediation", pattern: /\b(mediation|mediator)\b/i },
  { capability: "representation.tribunal", pattern: /\b(tribunal representation|tribunal advocate)\b/i },
  { capability: "representation.appeals", pattern: /\b(appeal|appellate)\b/i },
  { capability: "representation.advisory_only", pattern: /\b(advice only|advisory|one-off advice)\b/i },
];

const TRIBUNAL_PATTERNS: { capability: ProviderCapability; pattern: RegExp }[] = [
  { capability: "tribunal.employment", pattern: /\b(employment tribunal|et1|unfair dismissal tribunal)\b/i },
  { capability: "tribunal.family_court", pattern: /\b(family court|children act|divorce proceedings)\b/i },
  { capability: "tribunal.immigration", pattern: /\b(immigration tribunal|first-tier tribunal.*immigration|iat)\b/i },
  { capability: "tribunal.first_tier", pattern: /\b(first[- ]tier tribunal|ftt)\b/i },
  { capability: "tribunal.crown_court", pattern: /\b(crown court)\b/i },
  { capability: "tribunal.magistrates", pattern: /\b(magistrates court|magistrate)\b/i },
  { capability: "tribunal.send", pattern: /\b(send tribunal|sen tribunal|special educational needs|school exclusion)\b/i },
  { capability: "tribunal.parole_board", pattern: /\b(parole board)\b/i },
];

const SUPPORT_PATTERNS: { capability: ProviderCapability; pattern: RegExp }[] = [
  { capability: "support.domestic_abuse", pattern: /\b(domestic abuse|domestic violence)\b/i },
  { capability: "support.prison", pattern: /\b(prison law|prisoner|parole|recall)\b/i },
  { capability: "support.refugee_asylum", pattern: /\b(asylum|refugee|humanitarian protection)\b/i },
  { capability: "support.disability", pattern: /\b(disability|reasonable adjustment|equality act)\b/i },
  { capability: "support.mental_health", pattern: /\b(mental health|sectioning|mha)\b/i },
];

const CLIENT_PATTERNS: { capability: ProviderCapability; pattern: RegExp }[] = [
  { capability: "client.individual", pattern: /\b(individuals|private clients|members of the public)\b/i },
  { capability: "client.business", pattern: /\b(business|commercial|corporate|sme)\b/i },
  { capability: "client.charity", pattern: /\b(charity|nonprofit|cio|voluntary sector)\b/i },
  { capability: "client.vulnerable_adult", pattern: /\b(vulnerable adult|safeguarding)\b/i },
  { capability: "client.children_families", pattern: /\b(children|families|family law)\b/i },
];

function matchPatterns(
  text: string,
  patterns: { capability: ProviderCapability; pattern: RegExp }[],
  source: CapabilityExtractionSource,
  baseConfidence: number,
): ExtractedCapability[] {
  const out: ExtractedCapability[] = [];
  for (const { capability, pattern } of patterns) {
    const m = text.match(pattern);
    if (m) {
      out.push({
        capability,
        confidence: baseConfidence,
        source,
        evidence: m[0]?.slice(0, 80),
      });
    }
  }
  return out;
}

export type CapabilityExtractionInput = {
  text: string;
  practiceAreas?: string[];
  languages?: string[];
  legalAid?: boolean;
  freeConsultation?: boolean;
  consultationOptions?: string[];
  manualTags?: string[];
  source: CapabilityExtractionSource;
};

/**
 * Extract capabilities from structured + unstructured provider text.
 * Never invents capabilities without pattern evidence in supplied text/metadata.
 */
export function extractCapabilities(input: CapabilityExtractionInput): ExtractedCapability[] {
  const parts = [
    input.text,
    ...(input.practiceAreas ?? []),
    ...(input.manualTags ?? []),
  ];
  const blob = parts.filter(Boolean).join("\n");
  if (!blob.trim() && !(input.languages?.length || input.consultationOptions?.length)) {
    return [];
  }

  const base =
    input.source === "manual_tags" || input.source === "curated_metadata"
      ? 0.95
      : input.source === "legal_aid_categories"
        ? 0.92
        : input.source === "sra_description"
          ? 0.82
          : 0.75;

  const found: ExtractedCapability[] = [
    ...matchPatterns(blob, FUNDING_CAPABILITY_PATTERNS, input.source, base),
    ...matchPatterns(blob, URGENCY_CAPABILITY_PATTERNS, input.source, base),
    ...matchPatterns(blob, ACCESSIBILITY_CAPABILITY_PATTERNS, input.source, base),
    ...matchPatterns(blob, REPRESENTATION_PATTERNS, input.source, base * 0.95),
    ...matchPatterns(blob, TRIBUNAL_PATTERNS, input.source, base * 0.95),
    ...matchPatterns(blob, SUPPORT_PATTERNS, input.source, base * 0.9),
    ...matchPatterns(blob, CLIENT_PATTERNS, input.source, base * 0.85),
  ];

  if (input.legalAid) {
    found.push({
      capability: "funding.legal_aid",
      confidence: 0.98,
      source: input.source,
      evidence: "legalAid flag",
    });
  }
  if (input.freeConsultation) {
    found.push({
      capability: "funding.free_consultation",
      confidence: 0.95,
      source: input.source,
      evidence: "freeConsultation flag",
    });
  }

  for (const opt of input.consultationOptions ?? []) {
    const o = opt.toLowerCase();
    if (o === "fixed_fee") {
      found.push({ capability: "funding.fixed_fee", confidence: 0.94, source: "curated_metadata" });
    }
    if (o === "free_consultation") {
      found.push({ capability: "funding.free_consultation", confidence: 0.94, source: "curated_metadata" });
    }
    if (o === "video" || o === "phone") {
      found.push({
        capability: "accessibility.remote_consultation",
        confidence: 0.9,
        source: "curated_metadata",
      });
    }
  }

  for (const lang of input.languages ?? []) {
    const cap = languageSlugToCapability(lang);
    if (cap) {
      found.push({ capability: cap, confidence: 0.93, source: input.source, evidence: lang });
    }
  }

  for (const tag of normaliseCapabilities(input.manualTags ?? [])) {
    found.push({ capability: tag, confidence: 0.97, source: "manual_tags", evidence: tag });
  }

  const byCap = new Map<ProviderCapability, ExtractedCapability>();
  for (const e of found) {
    const prev = byCap.get(e.capability);
    if (!prev || e.confidence > prev.confidence) byCap.set(e.capability, e);
  }
  return [...byCap.values()];
}

export function capabilitiesToSlugList(extracted: ExtractedCapability[]): string[] {
  return extracted.map((e) => e.capability);
}
