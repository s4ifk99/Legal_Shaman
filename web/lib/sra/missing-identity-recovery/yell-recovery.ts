import { getCachedSearch, setCachedSearch } from "@/lib/sra/missing-identity-recovery/search-cache";
import { searchSerperOrganic } from "@/lib/search/serper-client";
import type { RecoveryContext, SraIdentityCandidateRecord } from "@/lib/sra/missing-identity-recovery/types";
import { scoreIdentityCandidate } from "@/lib/sra/missing-identity-recovery/confidence";
import { validateYellListing } from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";

export type YellListing = {
  businessName: string;
  phone?: string;
  address?: string;
  profileUrl: string;
  categories?: string;
};

export function buildYellQueries(ctx: RecoveryContext): string[] {
  const pc = ctx.postcode.trim();
  const town = ctx.city.trim();
  const q: string[] = [];
  if (pc) {
    q.push(`site:yell.com solicitors ${pc}`);
    q.push(`site:yell.com law firm ${pc}`);
  }
  if (town) q.push(`site:yell.com solicitors ${town}`);
  return [...new Set(q)].slice(0, 4);
}

function parseYellFromSerperHits(
  hits: { title: string; link: string; snippet: string }[],
  ctx: RecoveryContext,
): YellListing[] {
  const out: YellListing[] = [];
  for (const h of hits) {
    if (!/yell\.com/i.test(h.link)) continue;
    const name = h.title.replace(/\s*[-|–].*yell.*$/i, "").trim();
    if (!name || name.length < 3) continue;
    const phone = h.snippet.match(/(?:\+44|0)\d[\d\s]{8,14}\d/)?.[0]?.trim();
    out.push({
      businessName: name,
      phone,
      address: h.snippet.slice(0, 160),
      profileUrl: h.link,
      categories: /solicitor|law/i.test(h.snippet) ? "solicitors" : undefined,
    });
  }
  return out;
}

export async function recoverFromYell(
  ctx: RecoveryContext,
): Promise<{
  candidates: SraIdentityCandidateRecord[];
  queries: string[];
  topResults: { businessName: string; address?: string }[];
}> {
  const queries = buildYellQueries(ctx);
  const candidates: SraIdentityCandidateRecord[] = [];
  const seen = new Set<string>();
  const topResults: { businessName: string; address?: string }[] = [];

  for (const query of queries) {
    let hits = await getCachedSearch<{ title: string; link: string; snippet: string }[]>(
      "yell-serper",
      query,
    );
    if (!hits) {
      const resp = await searchSerperOrganic({
        q: query,
        gl: "uk",
        num: 8,
        cacheChannel: "yell-serper",
      });
      hits = resp.ok
        ? resp.results.map((r) => ({
            title: r.title,
            link: r.link,
            snippet: r.snippet,
          }))
        : [];
      if (!resp.ok && resp.disabled) {
        hits = [];
      }
      await setCachedSearch("yell-serper", query, hits);
    }

    const listings = parseYellFromSerperHits(hits ?? [], ctx);
    for (const listing of listings) {
      if (topResults.length >= 3) break;
      topResults.push({
        businessName: listing.businessName,
        address: listing.address,
      });
    }
    for (const listing of listings) {
      if (seen.has(listing.profileUrl)) continue;
      const yellGate = validateYellListing(listing);
      if (yellGate.rejected) continue;
      seen.add(listing.profileUrl);

      const evidence = `${listing.businessName} ${listing.categories ?? ""} ${listing.address ?? ""}`;
      const base = {
        sraId: ctx.sraId,
        candidateName: listing.businessName,
        sourceType: "yell" as const,
        sourceUrl: listing.profileUrl,
        evidenceText: evidence,
        candidatePhone: listing.phone,
        candidateAddress: listing.address,
        matchedPostcode: ctx.postcode || undefined,
        matchedTown: ctx.city || undefined,
      };
      const confidence = scoreIdentityCandidate({
        candidate: base,
        sraId: ctx.sraId,
        postcode: ctx.postcode,
        town: ctx.city,
        pageText: evidence,
      });
      candidates.push({
        ...base,
        confidence,
        status: "pending_review",
      });
    }
  }

  return { candidates, queries, topResults };
}
