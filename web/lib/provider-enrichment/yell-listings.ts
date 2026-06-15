import { getCachedSearch, setCachedSearch } from "@/lib/sra/missing-identity-recovery/search-cache";
import { searchSerperOrganic } from "@/lib/search/serper-client";
import {
  hasLegalFirmNameIndicators,
  isYellCategoryHeading,
  rejectCandidateName,
} from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import { normalisePc } from "@/lib/sra/missing-identity-recovery/confidence";

export type YellListingHit = {
  businessName: string;
  phone?: string;
  address?: string;
  website?: string;
  profileUrl: string;
  categories?: string;
};

export type YellFirmMatchResult = {
  score: number;
  exact: boolean;
  strong: boolean;
};

const LEGAL_CATEGORY_RE =
  /\b(solicitor|solicitors|law\s+firm|lawyers?|legal|barrister|chambers)\b/i;

export function isYellBusinessListingUrl(url: string): boolean {
  const u = url.trim();
  if (!/yell\.com/i.test(u)) return false;
  if (/\/(find|search|browse|listings)\b/i.test(u)) return false;
  return /\/biz\//i.test(u);
}

export function normaliseFirmNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(ltd|limited|llp|plc|solicitors?|law|legal)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreYellFirmNameMatch(approvedFirmName: string, yellBusinessName: string): YellFirmMatchResult {
  const a = normaliseFirmNameKey(approvedFirmName);
  const b = normaliseFirmNameKey(yellBusinessName);
  if (!a || !b) return { score: 0, exact: false, strong: false };
  if (a === b) return { score: 1, exact: true, strong: true };
  if (a.includes(b) || b.includes(a)) return { score: 0.96, exact: false, strong: true };

  const aTokens = new Set(a.split(" ").filter((t) => t.length > 2));
  const bTokens = new Set(b.split(" ").filter((t) => t.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return { score: 0, exact: false, strong: false };

  let overlap = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) overlap++;
  }
  const score = overlap / Math.max(aTokens.size, bTokens.size);
  return { score: Number(score.toFixed(3)), exact: false, strong: score >= 0.85 };
}

export function postcodeMatchesOrNearby(
  orgPostcode: string,
  listingAddress: string | undefined,
  listingPostcode?: string,
): boolean {
  const org = normalisePc(orgPostcode);
  if (!org || org.length < 5) return false;
  const blob = `${listingAddress ?? ""} ${listingPostcode ?? ""}`.replace(/\s+/g, "").toUpperCase();
  return blob.includes(org);
}

export function validateYellListingForEnrichment(
  listing: YellListingHit,
  approvedFirmName: string,
  orgPostcode: string,
): { ok: true; match: YellFirmMatchResult } | { ok: false; reason: string } {
  const nameReject = rejectCandidateName(listing.businessName, {
    sourceType: "yell",
    sourceUrl: listing.profileUrl,
  });
  if (nameReject.rejected) {
    if (
      nameReject.reason !== "missing_firm_indicators" ||
      !hasLegalFirmNameIndicators(approvedFirmName)
    ) {
      return { ok: false, reason: nameReject.reason };
    }
  }
  if (isYellCategoryHeading(listing.businessName)) {
    return { ok: false, reason: "yell_category_heading" };
  }
  if (!isYellBusinessListingUrl(listing.profileUrl)) {
    return { ok: false, reason: "yell_not_business_listing" };
  }
  if (!listing.address?.trim()) return { ok: false, reason: "yell_missing_address" };

  const evidence = `${listing.businessName} ${listing.categories ?? ""} ${listing.address}`;
  if (!LEGAL_CATEGORY_RE.test(evidence)) {
    return { ok: false, reason: "yell_not_legal_category" };
  }

  const match = scoreYellFirmNameMatch(approvedFirmName, listing.businessName);
  if (match.score < 0.75) return { ok: false, reason: "yell_firm_name_mismatch" };

  if (orgPostcode.trim() && !postcodeMatchesOrNearby(orgPostcode, listing.address)) {
    return { ok: false, reason: "yell_postcode_mismatch" };
  }

  return { ok: true, match };
}

/** Town discovery: legal business listing only (no approved firm name to match). */
export function validateYellDiscoveryListing(
  listing: YellListingHit,
  postcodeHint?: string,
): { ok: true } | { ok: false; reason: string } {
  const nameReject = rejectCandidateName(listing.businessName, {
    sourceType: "yell",
    sourceUrl: listing.profileUrl,
  });
  if (nameReject.rejected) return { ok: false, reason: nameReject.reason };
  if (isYellCategoryHeading(listing.businessName)) {
    return { ok: false, reason: "yell_category_heading" };
  }
  if (!isYellBusinessListingUrl(listing.profileUrl)) {
    return { ok: false, reason: "yell_not_business_listing" };
  }
  if (!listing.address?.trim()) return { ok: false, reason: "yell_missing_address" };
  const evidence = `${listing.businessName} ${listing.categories ?? ""} ${listing.address}`;
  if (!LEGAL_CATEGORY_RE.test(evidence)) {
    return { ok: false, reason: "yell_not_legal_category" };
  }
  if (postcodeHint?.trim() && !postcodeMatchesOrNearby(postcodeHint, listing.address)) {
    return { ok: false, reason: "yell_postcode_mismatch" };
  }
  return { ok: true };
}

export function buildYellEnrichmentQueries(args: {
  firmName: string;
  town?: string;
  postcode?: string;
}): string[] {
  const name = args.firmName.trim();
  const town = args.town?.trim() ?? "";
  const pc = args.postcode?.trim() ?? "";
  const q: string[] = [];
  if (name && pc) q.push(`"${name}" "${pc}" site:yell.com`);
  if (name && town) q.push(`"${name}" "${town}" site:yell.com`);
  if (name && town) q.push(`"${name}" solicitors "${town}"`);
  return [...new Set(q)].slice(0, 4);
}

export function buildYellTownDiscoveryQueries(args: {
  town?: string;
  postcode?: string;
}): string[] {
  const town = args.town?.trim() ?? "";
  const pc = args.postcode?.trim() ?? "";
  const q: string[] = [];
  if (town) {
    q.push(`site:yell.com solicitors "${town}"`);
    q.push(`site:yell.com law firm "${town}"`);
  }
  if (pc) {
    q.push(`site:yell.com solicitors "${pc}"`);
  }
  return [...new Set(q)].slice(0, 4);
}

async function fetchSerperOrganic(query: string): Promise<{ title: string; link: string; snippet: string }[]> {
  const resp = await searchSerperOrganic({
    q: query,
    gl: "uk",
    num: 10,
    cacheChannel: "yell-enrich-serper",
  });
  if (!resp.ok) return [];
  return resp.results.map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
  }));
}

export async function searchYellListings(query: string): Promise<YellListingHit[]> {
  let hits = await getCachedSearch<{ title: string; link: string; snippet: string }[]>(
    "yell-enrich-serper",
    query,
  );
  if (!hits) {
    hits = await fetchSerperOrganic(query);
  }
  return parseYellSerperHits(hits ?? []);
}

export function parseYellSerperHits(
  hits: { title: string; link: string; snippet: string }[],
): YellListingHit[] {
  const out: YellListingHit[] = [];
  const seen = new Set<string>();

  for (const h of hits) {
    if (!/yell\.com/i.test(h.link)) continue;
    if (!isYellBusinessListingUrl(h.link)) continue;

    const businessName = h.title.replace(/\s*[-|–].*yell.*$/i, "").trim();
    if (!businessName || businessName.length < 3) continue;
    if (seen.has(h.link)) continue;
    seen.add(h.link);

    const phone = h.snippet.match(/(?:\+44|0)\d[\d\s]{8,14}\d/)?.[0]?.trim();
    const website = h.snippet.match(/https?:\/\/[^\s]+/i)?.[0]?.trim();

    out.push({
      businessName,
      phone,
      address: h.snippet.slice(0, 200),
      website: website && !/yell\.com/i.test(website) ? website : undefined,
      profileUrl: h.link,
      categories: LEGAL_CATEGORY_RE.test(h.snippet) ? "solicitors" : undefined,
    });
  }

  return out;
}
