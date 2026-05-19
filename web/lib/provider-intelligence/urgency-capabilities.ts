import type { UrgencyCapability } from "@/lib/provider-intelligence/capability-taxonomy";

export const URGENCY_CAPABILITY_PATTERNS: { capability: UrgencyCapability; pattern: RegExp }[] = [
  {
    capability: "urgency.emergency_injunctions",
    pattern: /\b(emergency injunction|without notice|urgent injunction)\b/i,
  },
  {
    capability: "urgency.police_station",
    pattern: /\b(police station|custody suite|under arrest|detained at police)\b/i,
  },
  {
    capability: "urgency.prison_recall_parole",
    pattern: /\b(prison recall|parole breach|recalled to prison|parole board)\b/i,
  },
  {
    capability: "urgency.homelessness_eviction",
    pattern: /\b(evict|eviction|bailiff|homeless tonight|section 21)\b/i,
  },
  {
    capability: "urgency.immigration_detention",
    pattern: /\b(immigration detention|detained|removal centre|deportation)\b/i,
  },
  {
    capability: "urgency.domestic_abuse_emergency",
    pattern: /\b(domestic abuse|domestic violence|coercive control|afraid of partner)\b/i,
  },
  {
    capability: "urgency.urgent_child_matters",
    pattern: /\b(urgent child|child protection|care proceedings|emergency protection order)\b/i,
  },
];

export function urgencyCapabilitiesFromQuery(query: string): UrgencyCapability[] {
  const out: UrgencyCapability[] = [];
  for (const { capability, pattern } of URGENCY_CAPABILITY_PATTERNS) {
    if (pattern.test(query)) out.push(capability);
  }
  return out;
}

export function isUrgentSearchQuery(query: string): boolean {
  return urgencyCapabilitiesFromQuery(query).length > 0 || /\b(tonight|today|now|urgent|emergency|999)\b/i.test(query);
}
