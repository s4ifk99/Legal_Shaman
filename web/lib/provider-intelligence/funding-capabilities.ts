import type { FundingCapability } from "@/lib/provider-intelligence/capability-taxonomy";

export const FUNDING_CAPABILITY_PATTERNS: { capability: FundingCapability; pattern: RegExp }[] = [
  { capability: "funding.legal_aid", pattern: /\b(legal aid|laa|legalaid)\b/i },
  { capability: "funding.pro_bono", pattern: /\b(pro bono|probono|volunteer lawyer)\b/i },
  {
    capability: "funding.free_consultation",
    pattern: /\b(free consultation|free initial|no fee consultation|free advice session)\b/i,
  },
  { capability: "funding.fixed_fee", pattern: /\b(fixed fee|fixed-fee|fixed price)\b/i },
  {
    capability: "funding.conditional_fee",
    pattern: /\b(no win no fee|conditional fee|cfa|damages based)\b/i,
  },
  { capability: "funding.hourly_billing", pattern: /\b(hourly rate|charged per hour|hourly billing)\b/i },
];

export function fundingCapabilitiesFromQuery(query: string): FundingCapability[] {
  const out: FundingCapability[] = [];
  for (const { capability, pattern } of FUNDING_CAPABILITY_PATTERNS) {
    if (pattern.test(query)) out.push(capability);
  }
  return out;
}
