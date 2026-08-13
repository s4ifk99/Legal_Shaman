/** Issue → retrieval scope, planned intents, and title-level exclusions. */

export const ISSUE_RETRIEVAL_SCOPES: Record<string, string[]> = {
  parking_pcn: ["motoring", "parking", "administrative_appeals", "consumer"],
  consumer_vehicle_repair: ["consumer", "services", "vehicle_repair"],
  conveyancing: ["property", "conveyancing", "misrepresentation"],
  housing: ["housing", "landlord_tenant"],
  neighbour_dispute: ["property", "neighbours", "planning"],
  employment: ["employment"],
  immigration: ["immigration"],
  family: ["family"],
  debt: ["debt"],
  criminal_defence: ["crime", "motoring"],
  consumer: ["consumer"],
  consumer_services: ["consumer", "services"],
  consumer_small_claims: ["civil_claims", "consumer"],
};

export const ISSUE_RETRIEVAL_INTENTS: Record<string, string[]> = {
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
    "housing disrepair mould landlord repair",
    "section 21 notice tenant eviction",
    "tenancy deposit dispute",
    "share accommodation joint tenancy",
  ],
  neighbour_dispute: [
    "neighbour dispute boundary planning",
    "right of way driveway access",
  ],
  employment: ["unfair dismissal employment tribunal ACAS"],
  immigration: ["visa refusal immigration appeal"],
  debt: ["bailiff debt creditor"],
  criminal_defence: ["driving ban disqualification motoring"],
  consumer: ["consumer rights faulty goods refund"],
  consumer_services: ["poor service trader complaint"],
};

/** Title patterns that must not appear when this issue is primary. */
export const ISSUE_TITLE_EXCLUSIONS: Record<string, RegExp> = {
  parking_pcn: /employment|working time|rights at work|used car|car repair|travel agent/i,
  consumer_vehicle_repair: /employment|parking ticket|pcn|travel agent|insurance claim/i,
  conveyancing: /travel agent refund|used car|repairing a car|consumer contracts.*online|distance selling/i,
  housing: /used car|employment tribunal|parking ticket|travel agent/i,
  employment: /parking ticket|pcn|used car bought|conveyancing purchase/i,
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

export function plannedIntentsForFrame(primarySlugs: string[], secondarySlugs: string[]): string[] {
  const intents = new Set<string>();
  for (const slug of primarySlugs) {
    for (const i of ISSUE_RETRIEVAL_INTENTS[slug] || []) intents.add(i);
  }
  for (const slug of secondarySlugs.slice(0, 2)) {
    for (const i of (ISSUE_RETRIEVAL_INTENTS[slug] || []).slice(0, 2)) intents.add(i);
  }
  return [...intents];
}

export function exclusionPatternsForSlugs(slugs: string[]): RegExp[] {
  const patterns: RegExp[] = [];
  for (const slug of slugs) {
    const p = ISSUE_TITLE_EXCLUSIONS[slug];
    if (p) patterns.push(p);
  }
  return patterns;
}
