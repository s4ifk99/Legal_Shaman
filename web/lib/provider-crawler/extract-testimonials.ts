import type { CrawlSourceType, ExtractedFieldCandidate } from "@/lib/provider-crawler/types";
import { crawlConfidenceForSource } from "@/lib/provider-crawler/provenance";

const MAX_SNIPPET_LEN = 240;
const MIN_SNIPPET_LEN = 40;

/** Blockquote / testimonial-like patterns — short excerpts only. */
const TESTIMONIAL_PATTERNS = [
 /<blockquote[^>]*>([\s\S]{40,500}?)<\/blockquote>/gi,
 /class=["'][^"']*testimonial[^"']*["'][^>]*>([\s\S]{40,400}?)<\//gi,
 /["']([^"']{40,200})["']\s*[-–—]\s*[A-Z][a-z]+/g,
];

function cleanSnippet(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SNIPPET_LEN);
}

/**
 * Extract short testimonial snippets from HTML/text when clearly marked on the provider site.
 * Does not copy third-party review text (e.g. Trustpilot widgets).
 */
export function extractTestimonialSnippets(
  htmlOrText: string,
  ctx: {
    entityId: string;
    entityType: string;
    sourceUrl?: string;
    sourceType: CrawlSourceType;
  },
): ExtractedFieldCandidate[] {
  if (/trustpilot|reviews\.io|feefo|google\.com\/maps\/review/i.test(htmlOrText)) {
    return [];
  }

  const out: ExtractedFieldCandidate[] = [];
  const seen = new Set<string>();

  for (const re of TESTIMONIAL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(htmlOrText)) !== null) {
      const snippet = cleanSnippet(m[1] ?? m[0]);
      if (snippet.length < MIN_SNIPPET_LEN) continue;
      if (seen.has(snippet)) continue;
      seen.add(snippet);
      out.push({
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        fieldName: "testimonial_snippet",
        extractedValue: snippet,
        confidence: crawlConfidenceForSource(ctx.sourceType, 0.65),
        sourceUrl: ctx.sourceUrl,
        sourceType: ctx.sourceType,
        extractionMethod: "html_parse",
        reviewCategory: "testimonial",
        provenanceNote: "provider_site_testimonial",
        extractedAt: new Date(),
      });
      if (out.length >= 3) return out;
    }
  }

  return out;
}
