import type { ParsedQuery, SearchResult } from "@/lib/legal-search/types";
import { accessibilityCapabilitiesFromQuery } from "@/lib/provider-intelligence/accessibility-capabilities";
import { splitCapabilitiesByCategory } from "@/lib/provider-intelligence/capability-taxonomy";
import { fundingCapabilitiesFromQuery } from "@/lib/provider-intelligence/funding-capabilities";
import {
  isUrgentSearchQuery,
  urgencyCapabilitiesFromQuery,
} from "@/lib/provider-intelligence/urgency-capabilities";

export { isUrgentSearchQuery } from "@/lib/provider-intelligence/urgency-capabilities";
import { languageSlugToCapability } from "@/lib/provider-intelligence/capability-normaliser";

export type ProviderCapabilitySignals = {
  funding: string[];
  urgency: string[];
  accessibility: string[];
  languages: string[];
  tribunals: string[];
};

export type CapabilityMatchDebug = {
  capabilityMatches: string[];
  contactDataSource?: string;
  contactConfidence?: number;
  missingContactFields: string[];
  enrichmentStatus?: string;
  capabilityBoost: number;
};

function providerCapabilities(r: SearchResult): string[] {
  const raw = r.raw as {
    capabilities?: string[];
    fundingCapabilities?: string[];
    urgencyCapabilities?: string[];
    accessibilityCapabilities?: string[];
    tribunalCapabilities?: string[];
  } | null;
  if (raw?.capabilities?.length) return raw.capabilities;
  return [
    ...(raw?.fundingCapabilities ?? []),
    ...(raw?.urgencyCapabilities ?? []),
    ...(raw?.accessibilityCapabilities ?? []),
    ...(raw?.tribunalCapabilities ?? []),
  ];
}

function providerLanguages(r: SearchResult): string[] {
  const raw = r.raw as { languages?: string[] } | null;
  return r.languages ?? raw?.languages ?? [];
}

export function queryCapabilitySignals(query: string, parsed: ParsedQuery): ProviderCapabilitySignals {
  const q = `${query} ${parsed.semanticQuery}`;
  const langs: string[] = [];
  for (const l of parsed.languagePreference ?? []) {
    const cap = languageSlugToCapability(l);
    if (cap) langs.push(cap);
  }
  if (/\burdu\b/i.test(q)) langs.push("language.urdu");
  if (/\bpunjabi\b/i.test(q)) langs.push("language.punjabi");
  if (/\barabic\b/i.test(q)) langs.push("language.arabic");
  if (/\bbengali\b/i.test(q)) langs.push("language.bengali");
  if (/\bpolish\b/i.test(q)) langs.push("language.polish");
  if (/\bsend\b|school exclusion|special educational needs/i.test(q)) {
    return {
      funding: fundingCapabilitiesFromQuery(q),
      urgency: urgencyCapabilitiesFromQuery(q),
      accessibility: accessibilityCapabilitiesFromQuery(q),
      languages: [...new Set(langs)],
      tribunals: ["tribunal.send"],
    };
  }
  return {
    funding: fundingCapabilitiesFromQuery(q),
    urgency: urgencyCapabilitiesFromQuery(q),
    accessibility: accessibilityCapabilitiesFromQuery(q),
    languages: [...new Set(langs)],
    tribunals: [],
  };
}

function overlapScore(wanted: string[], have: string[]): number {
  if (!wanted.length) return 0;
  const set = new Set(have);
  let hits = 0;
  for (const w of wanted) {
    if (set.has(w)) hits++;
  }
  return hits / wanted.length;
}

function contactApproved(r: SearchResult): boolean {
  const raw = r.raw as {
    enrichmentStatus?: string;
    contactConfidence?: number;
    contactSource?: string;
  } | null;
  if (raw?.enrichmentStatus === "rejected") return false;
  if (raw?.enrichmentStatus === "approved" || raw?.enrichmentStatus === "auto_approved") {
    return Boolean(r.contact?.phone);
  }
  if (r.contact?.phone && !raw?.enrichmentStatus) {
    return true;
  }
  return false;
}

/**
 * Boost/rerank results using structured provider capabilities (reprioritize, not hard-filter).
 */
export function applyProviderCapabilityRanking(
  results: SearchResult[],
  parsed: ParsedQuery,
  opts?: { urgentIntent?: boolean },
): SearchResult[] {
  const q = parsed.semanticQuery;
  const signals = queryCapabilitySignals(q, parsed);
  const urgent =
    opts?.urgentIntent ?? (isUrgentSearchQuery(q) || parsed.intent === "emergency");

  return results.map((r) => {
    const caps = providerCapabilities(r);
    const langs = providerLanguages(r);
    const split = splitCapabilitiesByCategory(caps);

    let boost = 0;
    const matches: string[] = [];

    const fundScore = overlapScore(signals.funding, split.fundingCapabilities);
    if (fundScore > 0) {
      boost += fundScore * 0.08;
      matches.push(...signals.funding.filter((f) => split.fundingCapabilities.includes(f)));
    }

    const urgScore = overlapScore(signals.urgency, split.urgencyCapabilities);
    if (urgScore > 0) {
      boost += urgScore * 0.12;
      matches.push(...signals.urgency.filter((u) => split.urgencyCapabilities.includes(u)));
    }

    const accScore = overlapScore(signals.accessibility, split.accessibilityCapabilities);
    if (accScore > 0) {
      boost += accScore * 0.1;
      matches.push(...signals.accessibility.filter((a) => split.accessibilityCapabilities.includes(a)));
    }

    const langCaps = langs.map((l) => languageSlugToCapability(l)).filter(Boolean) as string[];
    const langScore = overlapScore(signals.languages, langCaps);
    if (langScore > 0) {
      boost += langScore * 0.14;
      matches.push(...signals.languages.filter((l) => langCaps.includes(l)));
    }

    const tribScore = overlapScore(signals.tribunals, split.tribunalCapabilities);
    if (tribScore > 0) {
      boost += tribScore * 0.12;
      matches.push(...signals.tribunals.filter((t) => split.tribunalCapabilities.includes(t)));
    }

    if (urgent && contactApproved(r)) {
      boost += 0.06;
      matches.push("contact.phone_approved");
    } else if (urgent && r.contact?.website) {
      boost += 0.02;
    }

    const raw = r.raw as Record<string, unknown> | null;
    const missingContact: string[] = [];
    if (!r.contact?.phone) missingContact.push("phone");
    if (!r.contact?.email) missingContact.push("email");
    if (!r.contact?.website) missingContact.push("website");

    const debug: CapabilityMatchDebug = {
      capabilityMatches: [...new Set(matches)],
      contactDataSource: raw?.contactSource as string | undefined,
      contactConfidence: raw?.contactConfidence as number | undefined,
      missingContactFields: missingContact,
      enrichmentStatus: raw?.enrichmentStatus as string | undefined,
      capabilityBoost: Math.round(boost * 1000) / 1000,
    };

    const final = Math.min(1, r.scores.final + boost);
    return {
      ...r,
      scores: { ...r.scores, final },
      raw: { ...raw, _capabilityDebug: debug },
    };
  });
}

/** Strip unapproved extracted phone numbers from API-facing results. */
export function sanitiseContactForDisplay(r: SearchResult): SearchResult {
  const raw = r.raw as { enrichmentStatus?: string; contactSource?: string } | null;
  const approved =
    !raw?.enrichmentStatus ||
    raw.enrichmentStatus === "approved" ||
    raw.enrichmentStatus === "auto_approved";
  const structuredSource =
    raw?.contactSource === "structured_db" ||
    raw?.contactSource === "govuk_legal_aid" ||
    raw?.contactSource === "curated_listing" ||
    raw?.contactSource === "sra_register";

  if (!approved && !structuredSource && (r.contact?.phone || r.contact?.email)) {
    return {
      ...r,
      contact: {
        ...r.contact,
        phone: r.contact?.phone ? undefined : r.contact?.phone,
        email: r.contact?.email ? undefined : r.contact?.email,
      },
    };
  }

  return r;
}
