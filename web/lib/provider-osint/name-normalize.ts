import { normalisePostcode } from "@/lib/search-index/normalise-address";

const FIRM_SUFFIX_RE =
  /\b(organisation|llp|llp\.|ltd|limited|plc|solicitors?|solicitor|law firm|lawyers?|chambers|partners|and co|& co)\b/gi;

export function normalizeFirmName(name: string): string {
  return name
    .toLowerCase()
    .replace(FIRM_SUFFIX_RE, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function firmNameTokens(name: string): string[] {
  const n = normalizeFirmName(name);
  return n.split(" ").filter((t) => t.length > 1);
}

export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(firmNameTokens(a));
  const tb = new Set(firmNameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

export function postcodeMatches(a?: string, b?: string): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  try {
    return normalisePostcode(a) === normalisePostcode(b);
  } catch {
    return a.trim().toUpperCase() === b.trim().toUpperCase();
  }
}

export function cityMatches(a?: string, b?: string): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
