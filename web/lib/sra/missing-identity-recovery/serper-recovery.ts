import type { RecoveryContext, SraIdentityCandidateRecord } from "@/lib/sra/missing-identity-recovery/types";
import { evaluateCandidateEvidence } from "@/lib/sra/missing-identity-recovery/candidate-evidence";
import {
  isUnacceptableSerperEvidenceUrl,
  rejectCandidateName,
} from "@/lib/sra/missing-identity-recovery/candidate-name-rejection";
import { searchSerperOrganic } from "@/lib/search/serper-client";

export type SerperHit = {
  title: string;
  link: string;
  snippet: string;
};

export function buildSerperQueries(ctx: RecoveryContext, addressLine?: string): string[] {
  const pc = ctx.postcode.trim();
  const queries: string[] = [];

  queries.push(`SRA ${ctx.sraId}`);
  queries.push(`"${ctx.sraId}" solicitor`);
  if (pc) {
    queries.push(`"${pc}" solicitor "SRA"`);
  }
  if (addressLine && addressLine.length > 8) {
    queries.push(`"${addressLine.slice(0, 80)}" solicitor`);
  }

  return [...new Set(queries)].slice(0, 6);
}

async function searchSerper(query: string): Promise<SerperHit[]> {
  const resp = await searchSerperOrganic({
    q: query,
    gl: "uk",
    num: 8,
    cacheChannel: "serper",
  });
  if (!resp.ok) return [];
  return resp.results.map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
  }));
}

function extractNameFromHit(hit: SerperHit): string | null {
  const title = hit.title.replace(/\s*[-|–].*$/, "").trim();
  if (title.length < 3 || title.length > 120) return null;
  if (/^https?:/i.test(title)) return null;
  return title;
}

export async function recoverFromSerper(
  ctx: RecoveryContext,
  addressLine?: string,
): Promise<{
  candidates: SraIdentityCandidateRecord[];
  queries: string[];
  topResults: { title: string; url: string }[];
}> {
  const queries = buildSerperQueries(ctx, addressLine);
  const candidates: SraIdentityCandidateRecord[] = [];
  const seen = new Set<string>();
  const topResults: { title: string; url: string }[] = [];

  for (const query of queries) {
    const hits = await searchSerper(query);
    for (const hit of hits) {
      if (!hit.link || topResults.length >= 3) continue;
      if (topResults.some((r) => r.url === hit.link)) continue;
      topResults.push({ title: hit.title, url: hit.link });
      if (topResults.length >= 3) break;
    }
    for (const hit of hits) {
      if (!hit.link || seen.has(hit.link)) continue;
      if (/yell\.com|facebook|linkedin|sra\.org|lawsociety|gov\.uk/i.test(hit.link)) {
        continue;
      }
      const name = extractNameFromHit(hit);
      if (!name) continue;
      if (isUnacceptableSerperEvidenceUrl(hit.link)) continue;
      if (
        rejectCandidateName(name, { sourceType: "serper", sourceUrl: hit.link }).rejected
      ) {
        continue;
      }
      seen.add(hit.link);

      const blob = `${hit.title} ${hit.snippet}`;
      const base = {
        sraId: ctx.sraId,
        candidateName: name,
        sourceType: "serper" as const,
        sourceUrl: hit.link,
        evidenceText: blob.slice(0, 400),
        candidateWebsite: /^https?:/i.test(hit.link) ? hit.link : undefined,
        matchedPostcode: ctx.postcode || undefined,
        matchedTown: ctx.city || undefined,
      };
      const evaluation = evaluateCandidateEvidence({
        ...base,
        orgPostcode: ctx.postcode,
        orgCity: ctx.city,
      });
      if (evaluation.rejected || evaluation.confidence <= 0) continue;
      candidates.push({
        ...base,
        confidence: evaluation.confidence,
        status: "pending_review",
      });
    }
  }

  return { candidates, queries, topResults };
}
