import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";

import type { IssueClassification } from "./types";

/** Narrow housing queries to a tenant-facing sub-issue label. */
export function inferHousingSubIssue(query: string): string | null {
  const lower = query.toLowerCase();
  if (/\b(deposit|tenancy deposit|holding deposit|bond)\b/.test(lower)) {
    return "deposit dispute";
  }
  if (/\b(eviction|section 21|section 8|possession|kicking me out|notice to quit)\b/.test(lower)) {
    return "eviction or possession";
  }
  if (/\b(disrepair|damp|mould|mold|repairs?|leak|unsafe)\b/.test(lower)) {
    return "housing disrepair";
  }
  if (/\b(homeless|homelessness)\b/.test(lower)) {
    return "homelessness";
  }
  if (/\b(neighbour|asb|anti-social|harassment)\b/.test(lower)) {
    return "neighbour dispute";
  }
  if (/\b(landlord|tenant|renting|tenancy|letting)\b/.test(lower)) {
    return "landlord and tenant";
  }
  return null;
}

export function classifyLegalIssue(query: string): IssueClassification {
  const resolution = resolveLegalIssueFromQuery(query);
  const lower = query.toLowerCase();

  if (!resolution) {
    return { area: "general", subArea: "", urgency: inferUrgency(lower, []) };
  }

  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === resolution.taxonomySlug);
  const emergencySignals = entry?.emergencySignals ?? [];

  let area = resolution.canonicalName;
  let specificIssue: string | undefined;

  if (resolution.taxonomySlug === "housing") {
    area = "Landlord and Tenant";
    specificIssue = inferHousingSubIssue(query) ?? undefined;
  }

  return {
    area,
    subArea: resolution.taxonomySlug,
    specificIssue,
    urgency: inferUrgency(lower, emergencySignals),
  };
}

function inferUrgency(
  lower: string,
  emergencySignals: string[],
): IssueClassification["urgency"] {
  for (const sig of emergencySignals) {
    const s = sig.toLowerCase();
    if (s.length >= 3 && lower.includes(s)) return "emergency";
  }
  if (/\b(domestic abuse|domestic violence|coercive control)\b/.test(lower)) {
    return "emergency";
  }
  if (/\b(urgent|tonight|immediately|asap|emergency|danger|unsafe)\b/.test(lower)) {
    return "high";
  }
  if (/\b(deadline|court date|hearing|tomorrow|this week)\b/.test(lower)) {
    return "medium";
  }
  return "low";
}

export function suggestedNextStepsForClassification(
  classification: IssueClassification,
): string[] {
  const steps: string[] = [
    "Read the cited official guidance below and check whether it matches your situation.",
    "Use the directory results to find regulated help, free advice, or legal aid where available.",
  ];

  if (classification.urgency === "emergency") {
    steps.unshift(
      "If you or someone else is in immediate danger, call 999. For domestic abuse support, call the National Domestic Abuse Helpline on 0808 2000 247.",
    );
  }

  if (classification.subArea === "housing") {
    steps.push("Shelter and Citizens Advice can help with urgent housing problems and disrepair.");
  }

  if (classification.subArea === "employment") {
    steps.push("ACAS offers free early conciliation for many employment disputes.");
  }

  return steps.slice(0, 5);
}
