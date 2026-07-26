import "server-only";

import { wikiPagePublicUrl } from "@/lib/wiki/public-url";
import { getWikiPageById, searchWikiPages } from "@/lib/wiki/search";
import type { WikiPageIndex } from "@/lib/wiki/types";

import { buildSnippet, estimateTokens } from "./chunker";
import type { LegalSearchIntent } from "./search-intent";
import type { RetrievedChunk } from "./types";

const MIN_WIKI_SCORE = 4;
const MAX_CHUNK_CHARS = 1_400;

function isQuarantined(page: WikiPageIndex): boolean {
  const path = page.relativePath.toLowerCase();
  return path.includes("_quarantine") || path.includes("/firms/_quarantine/");
}

/** Condensed query for wiki keyword search — long narratives dilute term scores. */
export function wikiSearchQueryForIntent(
  query: string,
  intent?: LegalSearchIntent,
): string {
  if (!intent) {
    return query.length > 280 ? query.slice(0, 280) : query;
  }

  const parts: string[] = [];
  if (intent.canonicalName) parts.push(intent.canonicalName);
  if (intent.specificIssue) parts.push(intent.specificIssue);
  for (const t of intent.searchBoostTerms.slice(0, 6)) parts.push(t);

  const q = query.toLowerCase();
  const cancelish =
    /\b(cancel|cancelled|cancellation|owe (him|her|them)|wants? me to (pay|transfer)|booking fee|cancellation fee)\b/i.test(
      q,
    );
  const traderish =
    /\b(tradesman|tradesmen|tiler|tiling|builder|plumber|electrician|roofer|handyman|decorator|contractor|trader)\b/i.test(
      q,
    );

  if (cancelish || intent.specificIssue?.toLowerCase().includes("cancel")) {
    parts.push(
      "cancelling a service you've arranged",
      "cancel a service",
      "cancellation rights",
      "consumer rights",
    );
  }
  if (traderish || intent.taxonomySlug?.startsWith("consumer")) {
    parts.push("problems with services or traders", "trader", "consumer rights");
  }

  const condensed = [...new Set(parts.map((p) => p.trim()).filter(Boolean))]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (condensed.length >= 12) return condensed.slice(0, 220);
  return query.length > 280 ? query.slice(0, 280) : query;
}

function pageToChunkText(page: WikiPageIndex): string {
  const blocks = [
    page.summary,
    page.keyInformation.length ? `Key information:\n- ${page.keyInformation.join("\n- ")}` : "",
    page.practicalGuidance.length
      ? `Practical guidance:\n- ${page.practicalGuidance.join("\n- ")}`
      : "",
    page.content ? page.content.replace(/\s+/g, " ").trim().slice(0, MAX_CHUNK_CHARS) : "",
  ].filter(Boolean);
  return blocks.join("\n\n").trim();
}

function wikiPageToChunk(page: WikiPageIndex, score: number, rank: number): RetrievedChunk {
  const chunkText = pageToChunkText(page);
  const authorityWeight = page.relativePath.startsWith("Areas/") ? 0.72 : 0.55;
  const finalScore = Math.max(0.35, Math.min(0.95, score / 80 + (1 - rank * 0.04)));

  return {
    id: `wiki:${page.id}`,
    documentId: page.id,
    sourceUrl: wikiPagePublicUrl(page.id),
    title: page.title,
    heading: page.category || null,
    chunkText,
    chunkIndex: 0,
    tokenCount: estimateTokens(chunkText),
    domain: "legalshaman.com",
    sourceName: "Legal Shaman Wiki",
    authorityWeight,
    fetchedAt: new Date(),
    sourceUpdatedAt: null,
    snippet: buildSnippet(chunkText, 280),
    relevanceScore: finalScore,
    authorityScore: authorityWeight,
    freshnessScore: 0.7,
    lexicalScore: finalScore,
    vectorScore: 0,
    phraseScore: Math.min(1, score / 40),
    finalScore,
  };
}

/**
 * Lexical wiki index → RetrievedChunk[] for Ask the Shaman when DB chunks are empty
 * (common on Vercel without DATA_DATABASE_URL) or sparse.
 */
export function retrieveWikiAsChunks(
  query: string,
  options?: { limit?: number; intent?: LegalSearchIntent; searchQuery?: string },
): RetrievedChunk[] {
  const limit = options?.limit ?? 8;
  const searchQ = options?.searchQuery?.trim() || wikiSearchQueryForIntent(query, options?.intent);
  const hits = searchWikiPages(searchQ, limit * 3)
    .filter((hit) => hit.score >= MIN_WIKI_SCORE)
    .filter((hit) => {
      const page = getWikiPageById(hit.id);
      if (!page) return false;
      if (isQuarantined(page)) return false;
      if (page.relativePath.endsWith("/_index.md") || page.title === "_index") return false;
      if (page.relativePath.startsWith("Directory/")) return false;
      if (options?.intent?.taxonomySlug?.startsWith("consumer")) {
        if (
          page.category === "Courts and Disputes" ||
          page.category === "Work and Employment" ||
          /\b(practice direction|part 48|legal aid, sentencing)\b/i.test(page.title)
        ) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      // Prefer cancel-service pages when the user is asking about cancelling / fees.
      const cancelish = /\bcancel/i.test(searchQ);
      if (!cancelish) return b.score - a.score;
      const aCancel = /\bcancel/i.test(a.title) ? 40 : 0;
      const bCancel = /\bcancel/i.test(b.title) ? 40 : 0;
      return b.score + bCancel - (a.score + aCancel);
    })
    .slice(0, limit);

  const chunks: RetrievedChunk[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const page = getWikiPageById(hit.id);
    if (!page) continue;
    chunks.push(wikiPageToChunk(page, hit.score, i));
  }
  return chunks;
}
