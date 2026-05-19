import "server-only";

import type { Candidate, SraOrgLite } from "@/lib/lawyers/search";
import type { LawyerWithRelations } from "@/lib/lawyers/db";
import type { ExtractedFilters, Jurisdiction } from "@/lib/agent/types";
import {
  applyBehaviouralBoostToFinal,
  computeBehaviouralBoostDelta,
  type RankingSignalLite,
} from "@/lib/search-events/behavioural-boost";
import { entityBoostKey } from "@/lib/search-events/types";
import { detectFundingIntent, fundingIntentPrefersPrivateSources } from "@/lib/legal-search/funding-intent";

export type ScoreBreakdown = {
  total: number;
  practiceAreaMatch: number;
  locationProximity: number;
  jurisdictionMatch: number;
  languageMatch: number;
  verifiedCredentials: number;
  availability: number;
  rating: number;
  semantic: number;
};

export type RankedCandidate =
  | {
      kind: "lawyer";
      lawyer: LawyerWithRelations;
      breakdown: ScoreBreakdown;
      sources: Candidate["sources"];
      cosineDistance: number | null;
    }
  | {
      kind: "org";
      org: SraOrgLite;
      /** Best-effort jurisdiction inferred from postcode prefix; falls back to "". */
      inferredJurisdiction: string;
      breakdown: ScoreBreakdown;
      sources: Candidate["sources"];
      cosineDistance: number | null;
    };

const W = {
  practiceArea: 0.3,
  location: 0.18,
  jurisdiction: 0.1,
  language: 0.08,
  verified: 0.07,
  availability: 0.07,
  rating: 0.1,
  semantic: 0.1,
};

/**
 * Small penalty applied to SRA-org candidates so a curated Lawyer ranks
 * above an org of equivalent semantic + location evidence. Tuneable.
 */
const ORG_PENALTY = 0.05;

const COUNTY_FROM_CITY: Record<string, string> = {
  london: "Greater London",
  manchester: "Greater Manchester",
  birmingham: "West Midlands",
  leeds: "West Yorkshire",
  liverpool: "Merseyside",
  bristol: "Bristol",
  edinburgh: "Edinburgh",
  glasgow: "Glasgow",
};

/**
 * Apply a weighted score to each candidate (lawyer or SRA org).
 * Every component is normalised to [0, 1] before weighting so the breakdown
 * is comparable across kinds. Pure and deterministic given the inputs.
 */
export type RankLawyersOptions = {
  behaviouralSignals?: Map<string, RankingSignalLite>;
};

export function rankLawyers(
  candidates: Candidate[],
  extracted: ExtractedFilters,
  opts?: RankLawyersOptions,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = candidates.map((c) =>
    c.kind === "lawyer"
      ? scoreLawyer(c, extracted, opts)
      : scoreOrg(c, extracted, opts),
  );
  ranked.sort((a, b) => b.breakdown.total - a.breakdown.total);
  return ranked;
}

/** Interleave lawyers and SRA orgs for generic private queries so one kind does not dominate. */
export function diversifyMatcherRanked(
  ranked: RankedCandidate[],
  query: string,
  k: number,
): RankedCandidate[] {
  const intent = detectFundingIntent(query);
  if (!fundingIntentPrefersPrivateSources(intent)) return ranked.slice(0, k);
  const lawyers = ranked.filter((r) => r.kind === "lawyer");
  const orgs = ranked.filter((r) => r.kind === "org");
  if (lawyers.length === 0 || orgs.length === 0) return ranked.slice(0, k);
  const out: RankedCandidate[] = [];
  let li = 0;
  let oi = 0;
  while (out.length < k && (li < lawyers.length || oi < orgs.length)) {
    if (out.length % 2 === 0 && li < lawyers.length) {
      out.push(lawyers[li]!);
      li++;
    } else if (oi < orgs.length) {
      out.push(orgs[oi]!);
      oi++;
    } else if (li < lawyers.length) {
      out.push(lawyers[li]!);
      li++;
    } else {
      break;
    }
  }
  return out;
}

// =============================================================================
// Lawyer scoring (unchanged weights from v1)
// =============================================================================

function matcherEntityKey(c: Candidate): { id: string; source: "lawyer" | "sra" } {
  return c.kind === "lawyer"
    ? { id: c.lawyer.id, source: "lawyer" }
    : { id: c.org.id, source: "sra" };
}

function applyMatcherBehaviouralBoost(
  total: number,
  breakdown: ScoreBreakdown,
  c: Candidate,
  opts?: RankLawyersOptions,
): number {
  const { id, source } = matcherEntityKey(c);
  const signal = opts?.behaviouralSignals?.get(entityBoostKey(source, id));
  const delta = computeBehaviouralBoostDelta(total, signal, {
    practiceArea: breakdown.practiceAreaMatch,
    keyword: breakdown.semantic,
  });
  return applyBehaviouralBoostToFinal(total, delta);
}

function scoreLawyer(
  c: Extract<Candidate, { kind: "lawyer" }>,
  q: ExtractedFilters,
  opts?: RankLawyersOptions,
): Extract<RankedCandidate, { kind: "lawyer" }> {
  const practiceAreaMatch = matchPracticeArea(c.lawyer, q);
  const locationProximity = matchLocation(c.lawyer, q);
  const jurisdictionMatch = matchJurisdiction(c.lawyer, q);
  const languageMatch = matchLanguage(c.lawyer, q);
  const verifiedCredentials = c.lawyer.verifiedCredentials ? 1 : 0;
  const availability = c.lawyer.availability?.acceptingClients ? 1 : 0.4;
  const rating = clamp01(c.lawyer.rating / 5);
  const semantic =
    c.cosineDistance == null
      ? c.sources.includes("typesense")
        ? 0.58
        : 0
      : clamp01(1 - c.cosineDistance);

  const breakdown: ScoreBreakdown = {
      practiceAreaMatch: round3(practiceAreaMatch),
      locationProximity: round3(locationProximity),
      jurisdictionMatch: round3(jurisdictionMatch),
      languageMatch: round3(languageMatch),
      verifiedCredentials: round3(verifiedCredentials),
      availability: round3(availability),
      rating: round3(rating),
      semantic: round3(semantic),
      total: 0,
    };

  const totalRaw =
    W.practiceArea * practiceAreaMatch +
    W.location * locationProximity +
    W.jurisdiction * jurisdictionMatch +
    W.language * languageMatch +
    W.verified * verifiedCredentials +
    W.availability * availability +
    W.rating * rating +
    W.semantic * semantic;
  breakdown.total = round3(applyMatcherBehaviouralBoost(totalRaw, breakdown, c, opts));

  return {
    kind: "lawyer",
    lawyer: c.lawyer,
    sources: c.sources,
    cosineDistance: c.cosineDistance,
    breakdown: {
      total: breakdown.total,
      practiceAreaMatch: breakdown.practiceAreaMatch,
      locationProximity: breakdown.locationProximity,
      jurisdictionMatch: breakdown.jurisdictionMatch,
      languageMatch: breakdown.languageMatch,
      verifiedCredentials: breakdown.verifiedCredentials,
      availability: breakdown.availability,
      rating: breakdown.rating,
      semantic: breakdown.semantic,
    },
  };
}

function matchPracticeArea(l: LawyerWithRelations, q: ExtractedFilters): number {
  if (!q.practiceArea) return 0.5;
  const slugs = l.practiceAreas.map((p) => p.practiceArea.slug);
  return slugs.includes(q.practiceArea) ? 1 : 0;
}

function matchLocation(l: LawyerWithRelations, q: ExtractedFilters): number {
  const loc = l.locations[0];
  if (!loc) return 0;
  return locationScore(loc.city, loc.postcode, loc.country, q);
}

function matchJurisdiction(l: LawyerWithRelations, q: ExtractedFilters): number {
  if (!q.jurisdiction) return 0.5;
  return l.locations.some((loc) => loc.jurisdiction === q.jurisdiction) ? 1 : 0;
}

function matchLanguage(l: LawyerWithRelations, q: ExtractedFilters): number {
  const requested = (q.languages ?? []).map((x) => x.toLowerCase().trim()).filter(Boolean);
  if (requested.length === 0) return 0.5;
  const have = new Set(l.languages.map((x) => x.language.name.toLowerCase()));
  const codes = new Set(l.languages.map((x) => x.language.code.toLowerCase()));
  const hits = requested.filter((r) => have.has(r) || codes.has(r)).length;
  return clamp01(hits / requested.length);
}

// =============================================================================
// SRA org scoring
//
// Orgs lack structured practice areas, languages, ratings, and availability —
// we use neutral defaults for those (0.5 / 0.6) so they aren't unfairly zeroed,
// and apply a small ORG_PENALTY so curated lawyers outrank firms with equal
// evidence. The verified component is always 1 (every SRA record is verified
// by definition).
// =============================================================================

function scoreOrg(
  c: Extract<Candidate, { kind: "org" }>,
  q: ExtractedFilters,
  opts?: RankLawyersOptions,
): Extract<RankedCandidate, { kind: "org" }> {
  const inferredJurisdiction = inferJurisdiction(c.org.postcode, c.org.country);

  const practiceAreaMatch = q.practiceArea ? 0.4 : 0.5; // unknown — neutral-ish
  const locationProximity = locationScore(c.org.city, c.org.postcode, c.org.country, q);
  const jurisdictionMatch = q.jurisdiction
    ? inferredJurisdiction && inferredJurisdiction === q.jurisdiction
      ? 1
      : 0
    : 0.5;
  const languageMatch = (q.languages?.length ?? 0) > 0 ? 0.4 : 0.5;
  const verifiedCredentials = 1; // SRA-listed = verified
  const availability = 0.6; // unknown, slightly above neutral
  const rating = 0; // no review data on orgs
  const semantic =
    c.cosineDistance == null
      ? c.sources.includes("typesense")
        ? 0.52
        : 0
      : clamp01(1 - c.cosineDistance);

  const totalRaw =
    W.practiceArea * practiceAreaMatch +
    W.location * locationProximity +
    W.jurisdiction * jurisdictionMatch +
    W.language * languageMatch +
    W.verified * verifiedCredentials +
    W.availability * availability +
    W.rating * rating +
    W.semantic * semantic;
  const breakdown: ScoreBreakdown = {
      practiceAreaMatch: round3(practiceAreaMatch),
      locationProximity: round3(locationProximity),
      jurisdictionMatch: round3(jurisdictionMatch),
      languageMatch: round3(languageMatch),
      verifiedCredentials: round3(verifiedCredentials),
      availability: round3(availability),
      rating: round3(rating),
      semantic: round3(semantic),
      total: 0,
    };
  const totalBeforeBoost = Math.max(0, totalRaw - ORG_PENALTY);
  breakdown.total = round3(applyMatcherBehaviouralBoost(totalBeforeBoost, breakdown, c, opts));

  return {
    kind: "org",
    org: c.org,
    inferredJurisdiction,
    sources: c.sources,
    cosineDistance: c.cosineDistance,
    breakdown: {
      total: breakdown.total,
      practiceAreaMatch: breakdown.practiceAreaMatch,
      locationProximity: breakdown.locationProximity,
      jurisdictionMatch: breakdown.jurisdictionMatch,
      languageMatch: breakdown.languageMatch,
      verifiedCredentials: breakdown.verifiedCredentials,
      availability: breakdown.availability,
      rating: breakdown.rating,
      semantic: breakdown.semantic,
    },
  };
}

/**
 * Best-effort jurisdiction from UK postcode area prefix.
 * Scotland: AB, DD, DG, EH, FK, G, HS, IV, KA, KW, KY, ML, PA, PH, TD, ZE.
 * Northern Ireland: BT.
 * Everything else: England & Wales (covers EN, WC, B, M, L, LS, BS, etc.).
 */
function inferJurisdiction(postcode: string | null | undefined, country: string | null | undefined): string {
  const p = (postcode ?? "").toUpperCase().trim();
  const area = p.match(/^[A-Z]{1,2}/)?.[0] ?? "";
  if (area === "BT") return "Northern Ireland" satisfies Jurisdiction;
  const scotlandAreas = new Set([
    "AB", "DD", "DG", "EH", "FK", "G", "HS", "IV", "KA", "KW", "KY", "ML", "PA", "PH", "TD", "ZE",
  ]);
  if (scotlandAreas.has(area)) return "Scotland" satisfies Jurisdiction;
  if (area) return "England & Wales" satisfies Jurisdiction;
  // If we have country=UK but no postcode, leave blank — the rank picks a 0/0.5.
  const c = (country ?? "").toLowerCase();
  return c.includes("united kingdom") || c.includes("england") || c.includes("wales") ? "England & Wales" : "";
}

// =============================================================================
// Shared helpers
// =============================================================================

function locationScore(
  city: string,
  postcode: string,
  country: string,
  q: ExtractedFilters,
): number {
  if (!q.city && !q.postcode) return 0.5;

  const qCity = q.city?.toLowerCase().trim();
  if (qCity && city.toLowerCase() === qCity) return 1;

  const qCounty = qCity ? COUNTY_FROM_CITY[qCity] : null;
  const cityCounty = COUNTY_FROM_CITY[city.toLowerCase()] ?? null;
  if (qCounty && cityCounty && qCounty === cityCounty) return 0.6;

  if (q.postcode && postcode && postcode.startsWith(q.postcode.toUpperCase().slice(0, 3))) {
    return 0.8;
  }

  return country.toLowerCase().includes("united kingdom") || country.toLowerCase().includes("england")
    ? 0.3
    : 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
