import type { LegalKnowledgeSource } from "./types";

/** Default trusted UK legal-help publishers for authority weighting. */
export const TRUSTED_LEGAL_SOURCES: LegalKnowledgeSource[] = [
  { domain: "gov.uk", name: "GOV.UK", authorityWeight: 1.0 },
  { domain: "citizensadvice.org.uk", name: "Citizens Advice", authorityWeight: 0.96 },
  { domain: "legislation.gov.uk", name: "Legislation.gov.uk", authorityWeight: 1.0 },
  { domain: "advicenow.org.uk", name: "Advicenow", authorityWeight: 0.9 },
  { domain: "lawsociety.org.uk", name: "Law Society", authorityWeight: 0.88 },
  { domain: "sra.org.uk", name: "SRA", authorityWeight: 0.88 },
  { domain: "lawworks.org.uk", name: "LawWorks", authorityWeight: 0.86 },
  { domain: "weareadvocate.org.uk", name: "Advocate", authorityWeight: 0.86 },
  { domain: "shelter.org.uk", name: "Shelter", authorityWeight: 0.9 },
  { domain: "acas.org.uk", name: "ACAS", authorityWeight: 0.92 },
  { domain: "legalshaman.com", name: "Legal Shaman Wiki", authorityWeight: 0.72 },
  { domain: "wiki.legalshaman", name: "Legal Shaman Wiki", authorityWeight: 0.72 },
];

const MARKETING_PENALTY =
  /\b(call us today|free consultation|award[- ]winning|leading firm|contact our team|expert solicitors in)\b/i;

export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "unknown";
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "");
  }
}

export function inferDomainFromUrl(url: string): string {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return "wiki.legalshaman";
  }
}

export function authorityForDomain(domain: string): { name: string; authorityWeight: number } {
  const normalized = normalizeDomain(domain);
  for (const row of TRUSTED_LEGAL_SOURCES) {
    if (normalized === row.domain || normalized.endsWith(`.${row.domain}`)) {
      return { name: row.name, authorityWeight: row.authorityWeight };
    }
  }
  if (/\.gov\.uk$/i.test(normalized) || normalized === "gov.uk") {
    return { name: "GOV.UK", authorityWeight: 0.98 };
  }
  if (/solicitor|law firm|lawyers/i.test(normalized)) {
    return { name: normalized, authorityWeight: 0.45 };
  }
  return { name: normalized, authorityWeight: 0.55 };
}

export function isMarketingContent(text: string): boolean {
  return MARKETING_PENALTY.test(text);
}

export function freshnessScoreFromDate(fetchedAt: Date, sourceUpdatedAt: Date | null): number {
  const ref = sourceUpdatedAt ?? fetchedAt;
  const ageDays = (Date.now() - ref.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 180) return 1;
  if (ageDays <= 365) return 0.85;
  if (ageDays <= 730) return 0.65;
  if (ageDays <= 1460) return 0.45;
  return 0.25;
}
