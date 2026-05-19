/** Canonical capability slugs for provider intelligence (indexed + ranked). */

export type CapabilityCategory =
  | "funding"
  | "urgency"
  | "accessibility"
  | "language"
  | "client_type"
  | "representation"
  | "tribunal"
  | "special_support";

export const FUNDING_CAPABILITIES = [
  "funding.legal_aid",
  "funding.pro_bono",
  "funding.free_consultation",
  "funding.fixed_fee",
  "funding.conditional_fee",
  "funding.hourly_billing",
] as const;

export const URGENCY_CAPABILITIES = [
  "urgency.emergency_injunctions",
  "urgency.police_station",
  "urgency.prison_recall_parole",
  "urgency.homelessness_eviction",
  "urgency.immigration_detention",
  "urgency.domestic_abuse_emergency",
  "urgency.urgent_child_matters",
] as const;

export const ACCESSIBILITY_CAPABILITIES = [
  "accessibility.wheelchair",
  "accessibility.interpreter",
  "accessibility.remote_consultation",
  "accessibility.home_visits",
  "accessibility.accessible_communication",
] as const;

export const LANGUAGE_CAPABILITIES = [
  "language.urdu",
  "language.punjabi",
  "language.arabic",
  "language.bengali",
  "language.polish",
  "language.english",
] as const;

export const CLIENT_TYPE_CAPABILITIES = [
  "client.individual",
  "client.business",
  "client.charity",
  "client.vulnerable_adult",
  "client.children_families",
] as const;

export const REPRESENTATION_CAPABILITIES = [
  "representation.litigation",
  "representation.mediation",
  "representation.tribunal",
  "representation.appeals",
  "representation.advisory_only",
] as const;

export const TRIBUNAL_CAPABILITIES = [
  "tribunal.employment",
  "tribunal.family_court",
  "tribunal.immigration",
  "tribunal.first_tier",
  "tribunal.crown_court",
  "tribunal.magistrates",
  "tribunal.send",
  "tribunal.parole_board",
] as const;

export const SPECIAL_SUPPORT_CAPABILITIES = [
  "support.domestic_abuse",
  "support.prison",
  "support.refugee_asylum",
  "support.disability",
  "support.mental_health",
] as const;

export type FundingCapability = (typeof FUNDING_CAPABILITIES)[number];
export type UrgencyCapability = (typeof URGENCY_CAPABILITIES)[number];
export type AccessibilityCapability = (typeof ACCESSIBILITY_CAPABILITIES)[number];
export type LanguageCapability = (typeof LANGUAGE_CAPABILITIES)[number];
export type ClientTypeCapability = (typeof CLIENT_TYPE_CAPABILITIES)[number];
export type RepresentationCapability = (typeof REPRESENTATION_CAPABILITIES)[number];
export type TribunalCapability = (typeof TRIBUNAL_CAPABILITIES)[number];
export type SpecialSupportCapability = (typeof SPECIAL_SUPPORT_CAPABILITIES)[number];

export type ProviderCapability =
  | FundingCapability
  | UrgencyCapability
  | AccessibilityCapability
  | LanguageCapability
  | ClientTypeCapability
  | RepresentationCapability
  | TribunalCapability
  | SpecialSupportCapability;

export const ALL_PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  ...FUNDING_CAPABILITIES,
  ...URGENCY_CAPABILITIES,
  ...ACCESSIBILITY_CAPABILITIES,
  ...LANGUAGE_CAPABILITIES,
  ...CLIENT_TYPE_CAPABILITIES,
  ...REPRESENTATION_CAPABILITIES,
  ...TRIBUNAL_CAPABILITIES,
  ...SPECIAL_SUPPORT_CAPABILITIES,
];

const CAPABILITY_SET = new Set<string>(ALL_PROVIDER_CAPABILITIES);

export function isKnownCapability(slug: string): slug is ProviderCapability {
  return CAPABILITY_SET.has(slug);
}

export function capabilityCategory(slug: string): CapabilityCategory | null {
  const prefix = slug.split(".")[0];
  switch (prefix) {
    case "funding":
      return "funding";
    case "urgency":
      return "urgency";
    case "accessibility":
      return "accessibility";
    case "language":
      return "language";
    case "client":
      return "client_type";
    case "representation":
      return "representation";
    case "tribunal":
      return "tribunal";
    case "support":
      return "special_support";
    default:
      return null;
  }
}

export function splitCapabilitiesByCategory(inputCapabilities: string[]): {
  fundingCapabilities: string[];
  urgencyCapabilities: string[];
  accessibilityCapabilities: string[];
  languages: string[];
  tribunalCapabilities: string[];
  capabilities: string[];
} {
  const fundingCapabilities: string[] = [];
  const urgencyCapabilities: string[] = [];
  const accessibilityCapabilities: string[] = [];
  const languages: string[] = [];
  const tribunalCapabilities: string[] = [];
  const allCapabilities: string[] = [];

  for (const c of inputCapabilities) {
    if (!isKnownCapability(c)) continue;
    allCapabilities.push(c);
    const cat = capabilityCategory(c);
    if (cat === "funding") fundingCapabilities.push(c);
    else if (cat === "urgency") urgencyCapabilities.push(c);
    else if (cat === "accessibility") accessibilityCapabilities.push(c);
    else if (cat === "language") languages.push(c.replace(/^language\./, ""));
    else if (cat === "tribunal") tribunalCapabilities.push(c);
  }

  return {
    fundingCapabilities,
    urgencyCapabilities,
    accessibilityCapabilities,
    languages,
    tribunalCapabilities,
    capabilities: allCapabilities,
  };
}
