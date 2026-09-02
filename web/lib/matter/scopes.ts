/** Issue → retrieval scope, planned intents, and title-level exclusions.
 *
 * Prefer conceptRetrievalPlan clusters over new special-cases here.
 * Area breadth defaults come from areaIntentDefaults (wiki Areas → slugs).
 */

import {
  SLUG_INTENT_DEFAULTS,
  SLUG_RETRIEVAL_SCOPES,
} from "./areaIntentDefaults";

const BASE_SCOPES: Record<string, string[]> = {
  parking_pcn: ["motoring", "parking", "administrative_appeals", "consumer"],
  consumer_vehicle_repair: ["consumer", "services", "vehicle_repair"],
  conveyancing: ["property", "conveyancing", "misrepresentation"],
  housing: ["housing", "landlord_tenant"],
  neighbour_dispute: ["property", "neighbours", "planning"],
  employment: ["employment"],
  immigration: ["immigration"],
  family: ["family"],
  debt: ["debt"],
  criminal_defence: ["crime", "motoring", "police"],
  consumer: ["consumer"],
  consumer_services: ["consumer", "services"],
  consumer_small_claims: ["civil_claims", "consumer"],
  discrimination_equality: ["equality", "discrimination"],
};

const BASE_INTENTS: Record<string, string[]> = {
  parking_pcn: [
    "appealing a parking ticket",
    "penalty charge notice council PCN",
    "London Tribunals parking appeal",
  ],
  consumer_vehicle_repair: [
    "problem with a car repair",
    "garage poor workmanship reasonable skill",
    "buying or repairing a car consumer",
  ],
  conveyancing: [
    "property misrepresentation claims",
    "buying and selling a home",
    "estate agent misleading property purchase",
    "misrepresentation property transaction",
  ],
  housing: [
    "illegal eviction lock out without court order",
    "homelessness duty emergency housing Shelter",
    "occupier no tenancy agreement service occupancy",
    "housing disrepair mould landlord repair",
    "section 21 notice tenant eviction",
    "tenancy deposit dispute",
  ],
  neighbour_dispute: [
    "neighbour dispute boundary planning",
    "right of way driveway access",
  ],
  employment: [
    "unfair dismissal employment tribunal ACAS",
    "employment rights at work ACAS",
    "dismissing an employee ACAS employer process",
    "return of company property employee",
  ],
  discrimination_equality: [
    "disability discrimination reasonable adjustments Equality Act",
    "equality act discrimination at work",
    "protected characteristics discrimination",
  ],
  immigration: [
    "visa refusal immigration appeal",
    "family visa partner spouse application",
  ],
  debt: ["bailiff debt creditor", "IVA bankruptcy debt solutions"],
  criminal_defence: [
    "arrested police station rights duty solicitor",
    "magistrates court charged with offence",
    "driving ban disqualification motoring",
  ],
  consumer: ["consumer rights faulty goods refund"],
  consumer_services: ["poor service trader complaint"],
  consumer_small_claims: [
    "deciding whether to make a small claim",
    "small claims court and letter before action",
    "letter before action money claim",
    "county court claim compensation",
  ],
  family: [
    "child arrangements contact order",
    "divorce finances family court",
    "domestic abuse protective order",
  ],
};

function mergeIntentMaps(
  base: Record<string, string[]>,
  area: Record<string, string[]>,
): Record<string, string[]> {
  const keys = new Set([...Object.keys(base), ...Object.keys(area)]);
  const out: Record<string, string[]> = {};
  for (const key of keys) {
    const merged: string[] = [];
    for (const intent of [...(base[key] || []), ...(area[key] || [])]) {
      if (!merged.includes(intent)) merged.push(intent);
    }
    out[key] = merged.slice(0, 8);
  }
  return out;
}

function mergeScopeMaps(
  base: Record<string, string[]>,
  area: Record<string, string[]>,
): Record<string, string[]> {
  const keys = new Set([...Object.keys(base), ...Object.keys(area)]);
  const out: Record<string, string[]> = {};
  for (const key of keys) {
    out[key] = [...new Set([...(base[key] || []), ...(area[key] || [])])];
  }
  return out;
}

/** Merged: hand-tuned bases + wiki Area defaults (covers wills, benefits, PI, education, …). */
export const ISSUE_RETRIEVAL_SCOPES: Record<string, string[]> = mergeScopeMaps(
  BASE_SCOPES,
  SLUG_RETRIEVAL_SCOPES,
);

export const ISSUE_RETRIEVAL_INTENTS: Record<string, string[]> = mergeIntentMaps(
  BASE_INTENTS,
  SLUG_INTENT_DEFAULTS,
);

/** Title patterns that must not appear when this issue is primary. */
export const ISSUE_TITLE_EXCLUSIONS: Record<string, RegExp> = {
  parking_pcn: /employment|working time|rights at work|used car|car repair|travel agent/i,
  consumer_vehicle_repair: /employment|parking ticket|pcn|travel agent|insurance claim/i,
  conveyancing: /travel agent refund|used car|repairing a car|consumer contracts.*online|distance selling/i,
  housing: /used car|employment tribunal|parking ticket|travel agent/i,
  employment: /parking ticket|pcn|used car bought|conveyancing purchase/i,
  wills_probate: /unfair dismissal|used car|parking ticket|section\s*21 tenant/i,
  welfare_benefits: /unfair dismissal|used car|neighbour driveway/i,
  personal_injury: /unfair dismissal schedule of loss|used car reject|visa/i,
  education: /unfair dismissal|used car|neighbour driveway/i,
  commercial: /unfair dismissal employee|section\s*21|neighbour driveway/i,
  consumer_small_claims:
    /child arrangements|custody|types of court orders in family|contact order|care order|divorce financial|tenant|tenancy|section\s*21|inheritance tax|10-?year charge|leasehold|mesher|disinherit|visa|indefinite leave/i,
};

export const GLOBAL_EXCLUSION_LABELS = [
  "employment",
  "used_vehicle",
  "travel_agent",
  "distance_contracts",
  "motor_insurance",
] as const;

export function retrievalScopeForSlugs(slugs: string[]): string[] {
  const out = new Set<string>();
  for (const slug of slugs) {
    for (const s of ISSUE_RETRIEVAL_SCOPES[slug] || [slug.replace(/_/g, " ")]) {
      out.add(s);
    }
  }
  return [...out];
}

/** Slug default intents (concept plan may suppress these when a cluster matches). */
export function intentsForIssueSlug(slug: string, _story = ""): string[] {
  return ISSUE_RETRIEVAL_INTENTS[slug] || [];
}

export function plannedIntentsForFrame(
  primarySlugs: string[],
  secondarySlugs: string[],
  _story = "",
): string[] {
  const intents = new Set<string>();
  for (const slug of primarySlugs) {
    for (const i of intentsForIssueSlug(slug)) intents.add(i);
  }
  for (const slug of secondarySlugs.slice(0, 2)) {
    for (const i of intentsForIssueSlug(slug).slice(0, 2)) intents.add(i);
  }
  return [...intents];
}

export function exclusionPatternsForSlugs(slugs: string[], _story = ""): RegExp[] {
  const patterns: RegExp[] = [];
  for (const slug of slugs) {
    const p = ISSUE_TITLE_EXCLUSIONS[slug];
    if (p) patterns.push(p);
  }
  return patterns;
}
