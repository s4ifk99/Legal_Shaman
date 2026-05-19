import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import type { ParsedQuery } from "@/lib/legal-search/types";
import type {
  RiskFlag,
  UrgencyLevel,
  UrgentSignposting,
} from "@/lib/legal-search/triage/types";

const RISK_PATTERNS: { flag: RiskFlag; pattern: RegExp }[] = [
  { flag: "police", pattern: /\b(arrest|arrested|police station|custody suite|bail hearing)\b/i },
  { flag: "prison", pattern: /\b(prison recall|recalled to prison|parole breach)\b/i },
  {
    flag: "domestic_abuse",
    pattern: /\b(domestic abuse|domestic violence|coercive control|afraid of partner)\b/i,
  },
  {
    flag: "eviction",
    pattern: /\b(evict|eviction|bailiff|section 21|notice to quit|possession order)\b/i,
  },
  {
    flag: "immigration_removal",
    pattern: /\b(deport|removal|detention centre|immigration raid|removal direction)\b/i,
  },
  {
    flag: "child_protection",
    pattern: /\b(child protection|social services took|care proceedings|emergency protection)\b/i,
  },
  {
    flag: "homelessness",
    pattern: /\b(homeless tonight|nowhere to stay|sleeping rough|evicted tonight)\b/i,
  },
  { flag: "detention", pattern: /\b(detained|in detention|immigration detention)\b/i },
  {
    flag: "court_deadline",
    pattern: /\b(court tomorrow|hearing tomorrow|deadline tomorrow|due in court)\b/i,
  },
];

export function assessUrgency(
  text: string,
  parsed: ParsedQuery,
): { urgency: UrgencyLevel; riskFlags: RiskFlag[] } {
  const flags = new Set<RiskFlag>();

  for (const { flag, pattern } of RISK_PATTERNS) {
    if (pattern.test(text)) flags.add(flag);
  }

  if (parsed.taxonomySlug) {
    const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === parsed.taxonomySlug);
    if (entry) {
      for (const signal of entry.emergencySignals) {
        if (text.toLowerCase().includes(signal.toLowerCase())) {
          if (entry.slug === "housing") flags.add("eviction");
          if (entry.slug === "immigration") flags.add("immigration_removal");
          if (entry.slug === "family") flags.add("child_protection");
          if (entry.slug === "prison_law") flags.add("prison");
          if (entry.slug === "criminal_defence") flags.add("police");
        }
      }
    }
  }

  if (parsed.intent === "emergency") flags.add("court_deadline");

  const riskFlags = [...flags];
  if (
    riskFlags.includes("domestic_abuse") ||
    riskFlags.includes("homelessness") ||
    riskFlags.includes("child_protection") ||
    (riskFlags.includes("police") && /\b(now|tonight|today)\b/i.test(text))
  ) {
    return { urgency: "urgent", riskFlags };
  }
  if (riskFlags.length > 0) return { urgency: "elevated", riskFlags };
  return { urgency: "normal", riskFlags };
}

export function buildUrgentSignposting(
  riskFlags: RiskFlag[],
  urgency: UrgencyLevel,
): UrgentSignposting | undefined {
  if (urgency === "normal" || !riskFlags.length) return undefined;

  const emergencyContacts: UrgentSignposting["emergencyContacts"] = [];

  if (riskFlags.includes("domestic_abuse")) {
    emergencyContacts.push({
      label: "National Domestic Abuse Helpline",
      detail: "0808 2000 247 (24 hours, UK)",
    });
  }
  if (riskFlags.includes("police")) {
    emergencyContacts.push({
      label: "If someone is in immediate danger",
      detail: "Call 999",
    });
  }
  if (riskFlags.includes("homelessness")) {
    emergencyContacts.push({
      label: "Shelter housing advice",
      detail: "0808 800 4444 (England)",
    });
  }

  const headline =
    urgency === "urgent"
      ? "Urgent situation — get help quickly"
      : "Time-sensitive issue — consider urgent options";

  const body =
    "These search results may help you find legal support. This tool cannot give legal advice. " +
    "If you or someone else is at immediate risk, contact emergency or specialist services first.";

  return { level: urgency, headline, body, emergencyContacts };
}

/** Emergency guidance shown at the start of low-confidence flows (policy §9). */
export function buildLowConfidenceEmergencyGuidance(): UrgentSignposting {
  return {
    level: "elevated",
    headline: "If you need emergency help",
    body:
      "If you or someone else is in immediate danger, call 999. " +
      "This tool signposts where to find legal help; it cannot tell you what to do in your case.",
    emergencyContacts: [
      { label: "Emergency services", detail: "999 (UK)" },
      {
        label: "National Domestic Abuse Helpline",
        detail: "0808 2000 247 (24 hours, UK)",
      },
    ],
  };
}

/** Block advice-like phrasing in triage-generated copy. */
export function triageCopyPassesSafety(text: string): boolean {
  const banned = /\b(you should|you must|we recommend|guarantee|will win|legal advice)\b/i;
  return text.trim().length > 0 && !banned.test(text);
}
