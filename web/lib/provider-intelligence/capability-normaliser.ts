import {
  ALL_PROVIDER_CAPABILITIES,
  isKnownCapability,
  type ProviderCapability,
} from "@/lib/provider-intelligence/capability-taxonomy";

const ALIASES: Record<string, ProviderCapability> = {
  legal_aid: "funding.legal_aid",
  "legal aid": "funding.legal_aid",
  pro_bono: "funding.pro_bono",
  "pro bono": "funding.pro_bono",
  free_consultation: "funding.free_consultation",
  fixed_fee: "funding.fixed_fee",
  police_station: "urgency.police_station",
  prison_recall: "urgency.prison_recall_parole",
  parole: "urgency.prison_recall_parole",
  send_tribunal: "tribunal.send",
  send: "tribunal.send",
  employment_tribunal: "tribunal.employment",
  urdu: "language.urdu",
  punjabi: "language.punjabi",
  arabic: "language.arabic",
  bengali: "language.bengali",
  polish: "language.polish",
  remote: "accessibility.remote_consultation",
  video: "accessibility.remote_consultation",
  wheelchair: "accessibility.wheelchair",
};

/** Normalise free-text or legacy tags to canonical capability slugs. */
export function normaliseCapabilityToken(raw: string): ProviderCapability | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!t) return null;
  if (isKnownCapability(t)) return t;
  if (isKnownCapability(`funding.${t}`)) return `funding.${t}` as ProviderCapability;
  if (ALIASES[t]) return ALIASES[t];
  const dotted = t.replace(/__/g, ".").replace(/_/g, ".");
  if (isKnownCapability(dotted)) return dotted;
  for (const cap of ALL_PROVIDER_CAPABILITIES) {
    if (cap.endsWith(`.${t}`) || cap.includes(t)) return cap;
  }
  return null;
}

export function normaliseCapabilities(raw: string[]): ProviderCapability[] {
  const seen = new Set<ProviderCapability>();
  for (const r of raw) {
    const n = normaliseCapabilityToken(r);
    if (n) seen.add(n);
  }
  return [...seen];
}

export function languageSlugToCapability(lang: string): ProviderCapability | null {
  const code = lang.trim().toLowerCase();
  const map: Record<string, ProviderCapability> = {
    urdu: "language.urdu",
    ur: "language.urdu",
    punjabi: "language.punjabi",
    pa: "language.punjabi",
    arabic: "language.arabic",
    ar: "language.arabic",
    bengali: "language.bengali",
    bn: "language.bengali",
    polish: "language.polish",
    pl: "language.polish",
    english: "language.english",
    en: "language.english",
  };
  return map[code] ?? normaliseCapabilityToken(`language.${code}`);
}
